
  const $ = (id) => document.getElementById(id);
  const teamsEl=$('teams'), errEl=$('err'), summaryEl=$('summary'),
        historyEl=$('history'), stepEl=$('step'), backRow=$('backRow');
  let currentName=null, currentTag=null, currentRegion='na';

  const setErr=(m)=>errEl.textContent=m||'';
  const show=(el,on)=>el.classList.toggle('hidden',!on);
  const esc=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function fmtDate(ms){
    if(!ms) return '';
    let n=Number(ms); if(n<1e12) n=n*1000;
    const d=new Date(n);
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  }
  function mapName(id){ return (id||'').replace('{/Game/Maps/','').replace(/.*\//,'').replace('_',' ').trim()||'Unknown map'; }

  async function api(path){
    const r=await fetch(path); const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error||('HTTP '+r.status));
    return j;
  }

  function mapErr(e){
    if(e.message==='NO_KEY') return 'Backend has no HENRIK_API_KEY set. Add it to .env and restart.';
    if(e.message==='KEY_INVALID') return 'HenrikDev key rejected — regenerate it in the dashboard.';
    if(e.message==='RATE_LIMITED') return 'Rate limited (30/min on Basic). Wait a moment.';
    if(e.message==='KEY_MISSING') return 'Backend is missing an API key. Add HENRIK_API_KEY to .env.';
    return 'Could not load: '+e.message;
  }

  $('searchBtn').addEventListener('click', async ()=>{
    const name=$('name').value.trim(), tag=$('tag').value.trim().replace(/^#/,''), region=$('region').value;
    setErr(''); show(teamsEl,false); show(summaryEl,false); show(historyEl,false); show(backRow,false);
    if(!name||!tag){ setErr('Enter both a game name and tag.'); return; }
    stepEl.textContent='Looking up '+name+'#'+tag+'…';
    try{
      const acct=await api(`/api/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?region=${region}`);
      currentName=name; currentTag=tag; currentRegion=region;
      stepEl.textContent='Found '+esc(acct.gameName)+'#'+esc(acct.tagLine)+' — loading history…';
      const list=await api(`/api/matches/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?region=${region}`);
      renderHistory(list.matches||[]);
    }catch(e){ stepEl.textContent=''; setErr(mapErr(e)); }
  });

  $('tag').addEventListener('keydown',(e)=>{ if(e.key==='Enter') $('searchBtn').click(); });
  $('name').addEventListener('keydown',(e)=>{ if(e.key==='Enter') $('searchBtn').click(); });

  function renderHistory(matches){
    show(historyEl,true); show(teamsEl,false); show(summaryEl,false); show(backRow,false);
    historyEl.innerHTML='';
    if(!matches.length){ stepEl.textContent='No recent matches found.'; return; }
    stepEl.textContent='Match history — tap a match to vibe-check the lobby:';
    matches.slice(0,20).forEach(m=>{
      const d=document.createElement('div'); d.className='match';
      d.innerHTML=`<div class="map">${esc(mapName(m.mapId))}</div>
        <div class="mode">${esc(m.gameMode||'')}</div>
        <div class="date">${fmtDate(m.startedAt)}</div>
        <div class="go">Vibe-check →</div>`;
      d.addEventListener('click',()=>openMatch(m.matchId));
      historyEl.appendChild(d);
    });
  }

  async function openMatch(matchId){
    setErr(''); stepEl.textContent='Loading match…';
    try{
      const raw=await api(`/api/match/${currentRegion}/${encodeURIComponent(matchId)}`);
      const result=window.AreTheyCheating.analyzeMatch(raw,null);
      show(historyEl,false); show(backRow,true); stepEl.textContent='Post-game vibe report';
      renderResult(result);
    }catch(e){ stepEl.textContent=''; setErr(mapErr(e)); }
  }

  $('demoBtn').addEventListener('click', async ()=>{
    setErr(''); show(historyEl,false); show(backRow,false); stepEl.textContent='Loading sample match…';
    try{
      const raw=await api('/api/demo');
      const result=window.AreTheyCheating.analyzeMatch(raw,null);
      show(backRow,true); stepEl.textContent='Sample data — not a real match';
      renderResult(result);
    }catch(e){ setErr(mapErr(e)); }
  });

  $('backBtn').addEventListener('click', async ()=>{
    show(teamsEl,false); show(summaryEl,false); show(backRow,false); stepEl.textContent='Match history:';
    try{
      const list=await api(`/api/matches/${encodeURIComponent(currentName)}/${encodeURIComponent(currentTag)}?region=${currentRegion}`);
      renderHistory(list.matches||[]);
    }catch(e){ setErr(mapErr(e)); }
  });

  function renderResult(result){
    show(teamsEl,true); show(summaryEl,true);
    const cheaters=result.players.filter(p=>p.cheaterPct>=65).length;
    const throwers=result.players.filter(p=>p.throwerPct>=70).length;
    summaryEl.innerHTML=`${result.players.length} players · ${result.rounds} rounds · `+
      `<b>${cheaters}</b> possible cheater(s) · <b>${throwers}</b> possible thrower(s). Grain of salt advised.`;
    teamsEl.innerHTML='';

    // group by team (normalize teamId/team field names)
    const byTeam={};
    result.players.forEach(p=>{
      const t=(p.teamId||p.team||'Unknown');
      (byTeam[t]=byTeam[t]||[]).push(p);
    });
    const teamMeta={
      Blue:{label:'Blue Team', dot:'#0071e3'},
      Red:{label:'Red Team',  dot:'#98989d'},
      Unknown:{label:'Unassigned', dot:'#c7c7cc'}
    };

    Object.keys(byTeam).forEach(team=>{
      const players=byTeam[team];
      const meta=teamMeta[team]||{label:esc(team), dot:'#c7c7cc'};
      const sec=document.createElement('div'); sec.className='team';
      sec.innerHTML=`<div class="team-head">
        <span class="team-dot" style="background:${meta.dot}"></span>
        <span class="team-name">${meta.label}</span>
        <span class="team-sub">${players.length} players</span></div>`;
      const grid=document.createElement('div'); grid.className='grid';
      [...players].sort((a,b)=>(b.cheaterPct+b.throwerPct)-(a.cheaterPct+a.throwerPct))
        .forEach(p=>grid.appendChild(card(p)));
      sec.appendChild(grid); teamsEl.appendChild(sec);
    });

    // animate meters after layout
    requestAnimationFrame(()=>{
      teamsEl.querySelectorAll('.fill').forEach(f=>{ f.style.width=f.dataset.w+'%'; });
    });
  }

  function card(p){
    const c=document.createElement('div');
    c.className='card'+(p.cheaterPct>=85?' cheat':'')+(p.cheaterPct<85&&p.throwerPct>=70?' throw':'');

    const isCheat=p.headline==='CHEATER VIBES';
    const badgeClass=isCheat?'c-badge cheat':'c-badge';
    const reasons=[...(p.cheaterReasons||[]),...(p.throwerReasons||[])];

    const verdictParts=[];
    if(p.cheaterVerdict) verdictParts.push(p.cheaterVerdict);
    if(p.throwerPct>=45 && p.throwerVerdict) verdictParts.push(p.throwerVerdict);
    const verdictHtml=verdictParts.map(v=>`<span class="q">“</span>${esc(v)}<span class="q">”</span>`).join(' ');

    c.innerHTML=`
      <div class="c-top">
        <div class="c-name">${esc(p.name)}<span class="ctag">#${esc(p.tag||'???')}</span></div>
        <div class="${badgeClass}">${esc(p.headline||'')}</div>
      </div>
      <div class="c-agent">${esc(p.agent||'unknown agent')}</div>
      <div class="c-line">
        <span>K <b>${p.kills}</b></span>
        <span>D <b>${p.deaths}</b></span>
        <span>A <b>${p.assists}</b></span>
        <span class="hs">HS <b>${Math.round(p.hsPct*100)}%</b></span>
        <span>ACS <b>${Math.round(p.scorePerRound*13)||'-'}</b></span>
      </div>
      <div class="meter">
        <div class="meter-row"><span>Cheating</span><b>${p.cheaterPct}%</b></div>
        <div class="track"><div class="fill cheat" data-w="${p.cheaterPct}"></div></div>
      </div>
      <div class="meter">
        <div class="meter-row"><span>Throwing</span><b>${p.throwerPct}%</b></div>
        <div class="track"><div class="fill throw" data-w="${p.throwerPct}"></div></div>
      </div>
      ${verdictHtml?`<div class="verdict">${verdictHtml}</div>`:''}
      ${reasons.length?`<details class="reasons"><summary>Why the vibes say so (${reasons.length})</summary><ul>${reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></details>`:''}
    `;
    return c;
  }

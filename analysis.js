/*
 * Are They Cheating? — analysis engine
 * ------------------------------------------------------------
 * Pure, dependency-free heuristics that turn a Valorant match's
 * per-player stats into a COMEDIC "cheating suspicion %" and a
 * "throwing suspicion %". This is SATIRE / vibes — it cannot and
 * does not actually detect cheating. For entertainment only.
 *
 * Logic is research-grounded (real Valorant HS% distributions by
 * rank/agent, Riot's "learning vs. disruptive" behavior framing,
 * wallhack = first-blood-with-low-first-death, etc). See README.
 *
 * Works in the browser (attaches to window.AreTheyCheating) and
 * in Node (module.exports) so we can unit-test it here.
 */
(function (root) {
  'use strict';

  // ---- small helpers -------------------------------------------------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const round = (n) => Math.round(n);

  // Deterministic +/-5 "vibe" jitter seeded from the player identity so the
  // same account gives a STABLE reading across loads (not random noise).
  function vibeJitter(str) {
    let h = 0;
    for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000;
    return (h % 11) - 5; // -5..+5
  }

  // Logistic ramp: 0 at kills=0, ~0.5 at center, ~1 well above.
  // Used as a SAMPLE-SIZE GATE so tiny samples can't max the meter.
  function logistic(x, center, steep) {
    return 1 / (1 + Math.exp(-(x - center) / steep));
  }

  // ---- Riot agent table --------------------------------------------
  // Maps characterId (or character name) -> {name, role, avgHS}.
  // avgHS from MetaBot competitive averages (Raze 20.8 -> Vyse 32.5),
  // global mean ~28.5%. Used to context-weight the HS% tell.
  const AGENTS = {
    'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc': { name: 'Raze',        role: 'duelist',    avgHS: 20.8 },
    'e370fa57-4757-3604-3648-499e1f642d3f': { name: 'Jett',        role: 'duelist',    avgHS: 30.3 },
    '9f0d8ba9-4140-b941-57d3-a7ad57c6b417': { name: 'Brimstone',   role: 'controller', avgHS: 26.1 },
    '117ed9e3-49f3-6512-47ef-e15ff464ea69': { name: 'Breach',      role: 'initiator',  avgHS: 29.0 },
    '601dbbe7-43ce-be57-2a40-4abd24953621': { name: 'Killjoy',     role: 'sentinel',   avgHS: 26.8 },
    '320b2a48-4d9b-a075-30f1-eb4d53fbcce9': { name: 'Cypher',      role: 'sentinel',   avgHS: 30.0 },
    '707eab51-4836-f488-046a-cda6bfd9d5e0': { name: 'Fade',        role: 'initiator',  avgHS: 30.2 },
    '1e58de9c-4950-5125-93e9-3e03fe7a2fd5': { name: 'Neon',        role: 'duelist',    avgHS: 21.4 },
    'f94c3b30-42be-e959-889c-5aa3131f7ca1': { name: 'Omen',        role: 'controller', avgHS: 29.7 },
    '95b78ed7-4634-ff7e-1fad-ffa9c15f0135': { name: 'Phoenix',     role: 'duelist',    avgHS: 29.1 },
    '569fdd95-4d10-43ab-ca70-79becc718b46': { name: 'Sage',        role: 'sentinel',   avgHS: 29.0 },
    'dade69b0-4f5f-9e5c-4b1a-ea492fe4c246': { name: 'Sova',        role: 'initiator',  avgHS: 30.5 },
    'edd79b32-be70-0b9e-40c8-8686-8c5b5c6a1b1c': { name: 'Reyna',  role: 'duelist',    avgHS: 31.5 },
    '462180ff-8be3-8a3e-86f8-2983ae2eefb8': { name: 'Chamber',     role: 'sentinel',   avgHS: 29.0 },
    '22697a3d-45bf-8dd7-4fec-84a9e29c69b8': { name: 'Yoru',        role: 'duelist',    avgHS: 29.3 },
    '0e38b510-41a8-5780-5e8f-568b2a4f99f4': { name: 'Astra',       role: 'controller', avgHS: 31.7 },
    '6f2a04ca-43e0-be17-7a2e-464159cf2151': { name: 'KAY/O',       role: 'initiator',  avgHS: 26.0 },
    'add6443a-41bd-e414-f6ad-e58d267f4e95': { name: 'Gekko',       role: 'initiator',  avgHS: 24.7 },
    'bb2a4828-46eb-8a1c-e330-f2cdcee6c9da': { name: 'Harbor',      role: 'controller', avgHS: 30.1 },
    '4a79e213-4997-29ca-9d4d-5943c25dfcf4': { name: 'Vyse',        role: 'sentinel',   avgHS: 32.5 },
    '1b47567c-8feb-45cf-9a3d-791b9a3c4a54': { name: 'Deadlock',    role: 'sentinel',   avgHS: 30.5 },
    'c0b7e8b4-4d86-3463-9601-df4d3422d293': { name: 'Iso',         role: 'duelist',    avgHS: 30.8 },
    '5c87bd5d-708a-21b2-7c8a-7e6e4f6a8a3f': { name: 'Clove',       role: 'controller', avgHS: 30.9 },
    'b44415ee-4adb-4dc9-991e-2c83c7e4e5a2': { name: 'Viper',       role: 'controller', avgHS: 30.9 },
    'efd19b9d-4041-ecbe-78e9-78f6d125e355': { name: 'Tejo',        role: 'initiator',  avgHS: 24.2 },
  };
  const AGENT_MEAN_HS = 28.5;
  function agentInfo(id) {
    if (!id) return { name: 'unknown', role: null, avgHS: AGENT_MEAN_HS };
    return AGENTS[id] || AGENTS[String(id).toLowerCase()] || { name: String(id), role: null, avgHS: AGENT_MEAN_HS };
  }

  // ---- parsing -------------------------------------------------------
  function parseMatch(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('No match data provided.');
    const info = raw.info || raw;
    const players = info.players || [];
    const teams = info.teams || [];
    if (!players.length) throw new Error('Match has no players.');

    const rounds = (teams[0] && teams[0].roundsPlayed) || 0;

    const list = players.map((p) => {
      const s = p.stats || {};
      const hs = s.headshots || 0;
      const bs = s.bodyshots || 0;
      const ls = s.legshots || 0;
      const totalShots = hs + bs + ls;
      const kills = s.kills || 0;
      const deaths = s.deaths || 0;
      const assists = s.assists || 0;
      const score = s.score || 0;
      const dmgDealt = s.damageDealt || 0;
      const dmgRecv = s.damageReceived || 0;
      const fb = s.firstBloods || 0;

      const kd = deaths === 0 ? kills : kills / deaths;
      const hsPct = totalShots === 0 ? 0 : hs / totalShots;
      const fbRate = rounds === 0 ? 0 : fb / rounds;
      const scorePerRound = rounds === 0 ? score : score / rounds;
      const dmgPerRound = rounds === 0 ? dmgDealt : dmgDealt / rounds;

      const ag = agentInfo(p.characterId || p.agent);

      return {
        puuid: p.puuid || '',
        name: p.gameName || p.name || (p.puuid ? 'Unknown' : 'Unknown'),
        tag: p.tagLine || '',
        agent: ag.name,
        agentId: p.characterId || p.agent || '',
        agentRole: ag.role,
        avgHS: ag.avgHS,
        team: p.teamId || p.team || '',
        premade: !!p.premade,
        kills, deaths, assists, score,
        hs, bs, ls, totalShots,
        dmgDealt, dmgRecv, fb,
        kd, hsPct, fbRate, scorePerRound, dmgPerRound,
        rounds,
      };
    });

    return { rounds, teams, players: list };
  }

  // ---- scoring: CHEATER ---------------------------------------------
  // HS% band curve: gentle then exploding. Reaches ~2 at 30%, ~8 at 40,
  // ~20 at 50 ("cracked"), ~40 at 60 ("suspect"), cap 85 at 75+.
  function hsBandPoints(hsPct) {
    const h = hsPct * 100;
    let pts = 0;
    const bands = [
      [0, 25, 0], [25, 30, 0.4], [30, 40, 0.6],
      [40, 50, 1.2], [50, 60, 2.0], [60, 75, 3.0],
    ];
    let prev = 0;
    for (const [lo, hi, slope] of bands) {
      if (h <= lo) break;
      const span = Math.min(h, hi) - lo;
      pts += span * slope;
      prev = hi;
      if (h <= hi) break;
    }
    return clamp(pts, 0, 85);
  }

  function cheaterScore(st) {
    let pts = 0;
    const reasons = [];
    const ssK = logistic(st.kills, 8, 3);        // sample gate on kills
    const ssD = logistic(st.deaths, 12, 4);       // deaths gate (stomp vs grind)

    // --- HS%: band curve x kills-gate x agent-factor ---
    if (st.hsPct > 0.25) {
      const af = clamp(1 + (AGENT_MEAN_HS - st.avgHS) / AGENT_MEAN_HS * 0.6, 0.75, 1.30);
      const add = hsBandPoints(st.hsPct) * ssK * af;
      pts += add;
      if (st.kills >= 10 && st.hsPct > 0.40) {
        const w = st.hsPct > 0.60 ? 'aiming like a wallhack'
          : st.hsPct > 0.50 ? 'laser-glued to heads' : 'cracked aim';
        reasons.push(`Headshot ${round(st.hsPct * 100)}% on ${st.kills} kills — ${w}` +
          (st.kills < 10 ? ' (small sample)' : ''));
      }
    }

    // --- KD gated by deaths (so 20/2 != 400/250) ---
    if (st.kd > 1.6) {
      const add = clamp((st.kd - 1.6) * 22, 0, 26) * (0.55 + 0.45 * ssD);
      pts += add;
      if (st.kd > 2.2 && st.deaths >= 12) reasons.push(`KD ${st.kd.toFixed(2)} over ${st.deaths} deaths — demon hours`);
    }

    // --- Combat score/round ---
    if (st.scorePerRound > 11) {
      const add = clamp((st.scorePerRound - 11) / 7 * 20, 0, 20);
      pts += add;
      if (st.scorePerRound > 15) reasons.push(`Combat score ${round(st.scorePerRound)}/round — statline of a demon`);
    }

    // --- First-blood = wallhack PROXY: high FB% but SURVIVES (low deaths/round) ---
    if (st.fbRate > 0.22) {
      const survive = clamp(1 - (st.deaths / Math.max(st.rounds, 1)) / 0.5, 0, 1); // 0 if dying >0.5/rd
      const add = clamp((st.fbRate - 0.22) * 70, 0, 16) * (0.5 + 0.5 * survive);
      pts += add;
      if (st.fbRate > 0.30 && survive > 0.5) reasons.push(`${round(st.fbRate * 100)}% first-bloods AND lived — always first to peek, untouched`);
    }

    // --- Damage efficiency per death (not raw per-round) ---
    if (st.deaths > 0 && st.dmgDealt / st.deaths > 250) {
      pts += clamp((st.dmgDealt / st.deaths - 250) / 12, 0, 10);
    }

    // --- Flawless, but only on a real-length game (no short stomp inflation) ---
    if (st.kills >= 20 && st.deaths <= 2 && st.rounds >= 20) {
      pts += 12;
      reasons.push(`${st.kills} kills, ${st.deaths} deaths over ${st.rounds} rounds — untouchable`);
    }

    const pct = clamp(round(5 + pts + vibeJitter(st.puuid + st.name)), 0, 99);
    return { pct, reasons };
  }

  // ---- scoring: THROWER (with JUST-BAD guard) -----------------------
  function throwerScore(st) {
    // Our per-match payload has NO first-death-rounds / AFK-rounds / team-kills,
    // so we approximate "throwing" from aggregates the API DOES give:
    //   - non-participation (score/round<4 and/or near-zero damage)
    //   - low KD AND few kills (feeding, not finishing)
    //   - damage skew (taking way more than dealing)
    //   - high deaths/round ONLY when KD is already bad (feed, not just dying)
    const duelRole = st.agentRole === 'duelist';

    const s_afk = clamp((st.scorePerRound < 4 ? 1 : 0) + (st.dmgDealt < 50 ? 0.7 : 0), 0, 1);
    const s_kd = clamp((0.6 - st.kd) / 0.6, 0, 1) * (st.kills <= 12 ? 1 : 0.5); // few kills = not finishing
    const s_dmg = st.dmgDealt > 0 ? clamp((st.dmgRecv / st.dmgDealt - 1.8) / 1.0, 0, 1) : 0;
    const s_fd = clamp((st.deaths / Math.max(st.rounds, 1) - 0.6) / 0.4, 0, 1) * (s_kd > 0.4 ? 1 : 0.3);

    const ThrowerRaw = 30 * s_afk + 30 * s_kd + 20 * s_dmg + 20 * s_fd;

    // JUST-BAD guard: passive inept, not active harm
    const acs = st.scorePerRound * 13; // rough ACS proxy
    const justBad = st.hsPct < 0.10 && st.kills <= 10 && acs < 150;

    let finalPts = ThrowerRaw;
    let label = '';
    if (justBad && st.kills <= 10) {
      finalPts = ThrowerRaw * 0.18;
      label = 'JUST BAD';
    } else if (ThrowerRaw >= 40) {
      label = 'THROWER';
    } else {
      finalPts = ThrowerRaw * 0.6;
      label = 'WEAK';
    }

    const reasons = [];
    if (s_afk >= 0.5) reasons.push('Near-zero score and damage — barely participating');
    if (s_kd > 0.3 && st.kills <= 12) reasons.push(`KD ${st.kd.toFixed(2)}, only ${st.kills} kills — feeding, not finishing`);
    if (s_dmg > 0.5) reasons.push('Taking way more damage than dealing');
    if (s_fd > 0.3) reasons.push(`Dies first a lot (${round(st.deaths / Math.max(st.rounds, 1) * 100)}% of rounds)${duelRole ? ' — but duelists do' : ''}`);
    if (justBad) reasons.push('Low HS%, few kills, low impact — looks inept, not malicious');

    // JUST-BAD is clearly low (no base/jitter so it can't float up); others get base+jitter.
    const pct = label === 'JUST BAD'
      ? clamp(round(finalPts), 0, 22)
      : clamp(round(3 + finalPts + vibeJitter(st.name + 'throw')), 0, 99);
    return { pct, reasons, label };
  }

  function cheaterVerdict(pct) {
    if (pct >= 85) return '🚨 99% SUS — uninstall, touch grass, seek help';
    if (pct >= 65) return '😳 Shadows are moving… someone sees through walls';
    if (pct >= 45) return '🤔 Suspicious, but could just be cracked';
    if (pct >= 25) return '🫤 Probably just good';
    return '✅ Clean (this time)';
  }

  function throwerVerdict(pct, label) {
    if (label === 'THROWER') return '🎭 Full throw arc — feeding for content';
    if (label === 'JUST BAD') return '🪑 Just bad, not throwing — we all start somewhere';
    if (pct >= 45) return '🪦 Might be throwing / having a rough one';
    if (pct >= 25) return '🎯 Playing normal-ish';
    return '🎯 Playing normal';
  }

  function headline(st, c, t) {
    if (t.label === 'THROWER' || t.pct >= 70) return 'THROWER DETECTED';
    if (c.pct >= 85) return 'CHEATER VIBES';
    if (c.pct >= 45) return 'LOOKING SUS';
    return 'PROBABLY FINE';
  }

  // ---- public API ----------------------------------------------------
  function analyzeMatch(raw, myPuuid) {
    const { rounds, teams, players } = parseMatch(raw);
    const verdicts = players.map((st) => {
      const c = cheaterScore(st);
      const t = throwerScore(st);
      return {
        ...st,
        cheaterPct: c.pct,
        throwerPct: t.pct,
        cheaterReasons: c.reasons,
        throwerReasons: t.reasons,
        throwerLabel: t.label,
        cheaterVerdict: cheaterVerdict(c.pct),
        throwerVerdict: throwerVerdict(t.pct, t.label),
        headline: headline(st, c, t),
        isEnemy: myPuuid ? st.team !== (players.find((x) => x.puuid === myPuuid) || {}).team : true,
      };
    });
    return { rounds, teams, players: verdicts };
  }

  const api = { analyzeMatch, parseMatch, cheaterScore, throwerScore, cheaterVerdict, throwerVerdict, agentInfo, AGENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AreTheyCheating = api;
})(typeof window !== 'undefined' ? window : globalThis);

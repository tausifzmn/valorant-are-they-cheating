/*
 * Are They Cheating? — analysis engine
 * ------------------------------------------------------------
 * Pure, dependency-free heuristics that turn a Valorant match's
 * per-player stats into a COMEDIC "cheating suspicion %", a
 * "smurf suspicion %", and a "throwing suspicion %".
 * This is SATIRE / vibes — it cannot and does not actually detect
 * cheating or smurfing. For entertainment only.
 *
 * Research-grounded (real Valorant stat distributions by rank/agent,
 * Riot's "learning vs. disruptive" behavior framing, community
 * cheat-tell consensus). See README.
 *
 * Works in the browser (attaches to window.AreTheyCheating) and
 * in Node (module.exports) so we can unit-test it here.
 */
(function (root) {
  'use strict';

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const round = (n) => Math.round(n);
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  // Deterministic +-5 "vibe" jitter seeded from the player identity so the
  // same account gives a STABLE reading across loads (not random noise).
  function vibeJitter(str) {
    let h = 0;
    for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000;
    return (h % 11) - 5; // -5..+5
  }
  // Goofy "regular player" tags so a normal game gets a funny name instead of
  // being lumped in as a smurf or a suspect. Picked deterministically from the
  // player name so the same person always gets the same tag.
  const REGULAR_TAGS = ['Regular Andy', 'Normie Nick', 'Average Joe', 'Plain Pam', 'Mid Mike', 'Casual Carl', 'Chill Chen', 'Standard Sam', 'Typical Tara', 'Everyday Evan'];
  function regularTag(name) {
    let h = 0; const s = name || 'player';
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) % 1000;
    return REGULAR_TAGS[h % REGULAR_TAGS.length];
  }
  const logistic = (x, center, steep) => 1 / (1 + Math.exp(-(x - center) / steep));

  // ---- Riot agent table --------------------------------------------
  const AGENTS = {
    'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc': { name: 'Raze',        role: 'duelist',    avgHS: 20.8 },
    'e370fa57-4757-3604-3648-499e1f642d3f': { name: 'Jett',        role: 'duelist',    avgHS: 30.3 },
    '9f0d8ba9-4140-b941-57d3-a7ad57c6b417': { name: 'Brimstone',   role: 'controller', avgHS: 26.1 },
    '117ed9e3-49f3-6512-47ef-e15ff464ea69': { name: 'Breach',      role: 'initiator',  avgHS: 29.0 },
    '601dbbe7-43ce-be57-2a40-4abd24953621': { name: 'Killjoy',     role: 'sentinel',   avgHS: 26.8 },
    '320b2a48-4d10-43ab-ca70-79becc718b46': { name: 'Sage',        role: 'sentinel',   avgHS: 29.0 },
    'f94c3b30-42be-e959-889c-5aa3131f7ca1': { name: 'Omen',        role: 'controller', avgHS: 29.7 },
    '95b78ed7-4634-ff7e-1fad-ffa9c15f0135': { name: 'Phoenix',     role: 'duelist',    avgHS: 29.1 },
    '462180ff-8be3-8a3c-e330-f2cdcee6c9da': { name: 'Chamber',     role: 'sentinel',   avgHS: 29.0 },
    '1b47567c-8feb-45cf-9a3d-791b9a3c4a54': { name: 'Deadlock',    role: 'sentinel',   avgHS: 30.5 },
    '4a79e213-4997-29ca-9d4d-5943c25dfcf4': { name: 'Vyse',        role: 'sentinel',   avgHS: 32.5 },
    '707eab51-4836-f488-046a-cda6bfd9d5e0': { name: 'Fade',        role: 'initiator',  avgHS: 30.2 },
    'c0b7e8b4-4d86-3463-9601-df4d3422d293': { name: 'Iso',         role: 'duelist',    avgHS: 30.8 },
    '5c87bd5d-708a-21b2-7c8a-7e6e4f6a8a3f': { name: 'Clove',       role: 'controller', avgHS: 30.9 },
    'b44415ee-4adb-4dc9-991e-2c83c7e4e5a3': { name: 'Viper',       role: 'controller', avgHS: 30.9 },
    '6f2a04ca-43e0-be17-7a2e-464159cf2151': { name: 'KAY/O',       role: 'initiator',  avgHS: 26.0 },
    'add6443a-41bd-e414-f6ad-e58d267f4e95': { name: 'Gekko',       role: 'initiator',  avgHS: 24.7 },
    'bb2a4828-46eb-8a1c-e330-f2cdcee6e5a3': { name: 'Harbor',      role: 'controller', avgHS: 30.1 },
    '22697a3d-45bf-8dd7-4fec-84a9e29c69b8': { name: 'Yoru',        role: 'duelist',    avgHS: 29.3 },
    '0e38b510-41a8-5780-5e8f-568b2a4f99f4': { name: 'Astra',       role: 'controller', avgHS: 31.7 },
    '1e58de9c-4950-5125-93e9-3e03fe7a2fd5': { name: 'Neon',        role: 'duelist',    avgHS: 21.4 },
    'edd79b32-be70-0b9e-40c8-8686-8c5b5c6a1b1c': { name: 'Reyna', role: 'duelist',    avgHS: 31.5 },
    'dade69b0-4f5f-9e5c-4b1a-ea492fe4c246': { name: 'Sova',        role: 'initiator',  avgHS: 30.5 },
    'efd19b9d-4041-ecbe-78e9-78f6d125e355': { name: 'Tejo',        role: 'initiator',  avgHS: 24.2 },
    '569fdd95-4d10-43ab-ca70-79becc718b46': { name: 'Killjoy',     role: 'sentinel',   avgHS: 26.8 },
  };
  const AGENT_MEAN_HS = 28.5;
  function agentInfo(id) {
    if (!id) return { name: 'unknown agent', role: null, avgHS: AGENT_MEAN_HS };
    if (typeof id === 'object') id = id.id || id.uuid || ''; // defensively unwrap nested objects
    return AGENTS[id] || AGENTS[String(id).toLowerCase()] || { name: 'unknown agent', role: null, avgHS: AGENT_MEAN_HS };
  }

  // ---- Rank baselines -----------------------------------------------
  // tier index 0..27 (HenrikDev current.tier.id). 0 = Unranked.
  // medians: HS% / KD / ACS (mid-2026 public benchmarks; see README).
  const RANKS = [
    { id: 0,  name: 'Unranked',  hs: 22, kd: 1.0, acs: 210 }, // unknown -> neutral
    { id: 3,  name: 'Iron',      hs: 11, kd: 0.90, acs: 207 },
    { id: 6,  name: 'Bronze',    hs: 18.5, kd: 0.94, acs: 204 },
    { id: 9,  name: 'Silver',    hs: 21.1, kd: 0.99, acs: 211 },
    { id: 12, name: 'Gold',      hs: 22.8, kd: 1.03, acs: 213 },
    { id: 15, name: 'Platinum',  hs: 25.2, kd: 0.99, acs: 216 },
    { id: 18, name: 'Diamond',   hs: 26.9, kd: 1.01, acs: 211 },
    { id: 21, name: 'Ascendant', hs: 24.6, kd: 1.01, acs: 213 },
    { id: 24, name: 'Immortal',  hs: 29, kd: 1.10, acs: 280 },
    { id: 27, name: 'Radiant',   hs: 31, kd: 1.20, acs: 320 },
  ];
  function rankById(id) {
    const r = RANKS.find((x) => x.id === id);
    if (r) return r;
    // interpolate to nearest known tier band
    if (id < 3) return RANKS[0];
    const lower = [...RANKS].filter((x) => x.id <= id).pop() || RANKS[1];
    const upper = [...RANKS].filter((x) => x.id >= id).find((x) => x.id !== id) || lower;
    return { id, name: 'Unknown', hs: (lower.hs + upper.hs) / 2, kd: (lower.kd + upper.kd) / 2, acs: (lower.acs + upper.acs) / 2 };
  }
  // Rank factor for the THROWER score: low rank = "learning" (down-weight),
  // high rank = "shouldn't be there" (up-weight sabotage).
  function rankFactor(r) {
    const rf = 0.25 + 0.22 * Math.max(0, Math.min(8, r - 1));
    return clamp(rf, 0.25, 2.05);
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
      const hs = s.headshots || 0, bs = s.bodyshots || 0, ls = s.legshots || 0;
      const totalShots = hs + bs + ls;
      const kills = s.kills || 0, deaths = s.deaths || 0, assists = s.assists || 0;
      const score = s.score || 0, dmgDealt = s.damageDealt || 0, dmgRecv = s.damageReceived || 0;
      const fb = s.firstBloods || 0;
      const kd = deaths === 0 ? kills : kills / deaths;
      const hsPct = totalShots === 0 ? 0 : hs / totalShots;
      const fbRate = rounds === 0 ? 0 : fb / rounds;
      const scorePerRound = rounds === 0 ? score : score / rounds;
      const dmgPerRound = rounds === 0 ? dmgDealt : dmgDealt / rounds;
      const ag = agentInfo(p.characterId || p.agent);
      // Prefer a resolved name from our table; otherwise use the API's display
      // name (if provided) so we never render a raw UUID or "[object Object]".
      const agentName = ag.name !== 'unknown agent' ? ag.name
        : (p.characterName || p.agentName || 'unknown agent');
      return {
        puuid: p.puuid || '', name: p.gameName || p.name || 'Unknown', tag: p.tagLine || '',
        agent: agentName, agentId: p.characterId || p.agent || '', agentRole: ag.role, avgHS: ag.avgHS,
        team: p.teamId || p.team || '', premade: !!p.premade,
        kills, deaths, assists, score, hs, bs, ls, totalShots, dmgDealt, dmgRecv, fb,
        kd, hsPct, fbRate, scorePerRound, dmgPerRound, rounds,
      };
    });
    return { rounds, teams, players: list };
  }

  // ---- scoring: CHEATER (3-layer: HARD + SOFT + SMURF) --------------
  function cheaterScore(st, rankTierId) {
    const rank = rankById(rankTierId || 0);
    const reasons = [];
    let H = 0; // hard, rank-invariant

    // HARD tells — cheating is cheating, any rank
    let h1 = 0, h2 = 0, h3 = 0, h4 = 0;
    if (st.hsPct >= 0.60) h1 = 1.0;
    else if (st.hsPct >= 0.50) h1 = 0.5;
    if (st.deaths === 0 && st.kills >= 20) h2 = 1.0;
    else if (st.deaths <= 1 && st.kills >= 25) h2 = 0.7;
    if (st.dmgPerRound >= 280 && st.rounds > 0) h3 = 1.0;
    else if (st.dmgPerRound >= 230) h3 = 0.4;
    const survive = st.rounds > 0 ? 1 - clamp(st.deaths / st.rounds / 0.5, 0, 1) : 0;
    if (st.fbRate >= 0.9 && survive >= 0.9) h4 = 1.0;
    H = 100 * (0.45 * h1 + 0.25 * h2 + 0.20 * h3 + 0.10 * h4);
    if (h1 >= 0.5) reasons.push(`Headshot ${round(st.hsPct * 100)}% — that's not human at any rank`);
    if (h2 >= 0.7) reasons.push(`${st.kills} kills, ${st.deaths} deaths — untouchable`);
    if (h3 >= 0.4) reasons.push(`Damage/round ${round(st.dmgPerRound)} — absurd output`);
    if (h4 >= 0.9) reasons.push(`${round(st.fbRate * 100)}% first-bloods AND survived — wallhack signature`);

    // SOFT — rank-relative HS% gated by RF(rank). Only HS% is genuinely rank-relative.
    let S = 0;
    if (st.hsPct > 0.25) {
      const delta = st.hsPct * 100 - rank.hs;        // pp above rank median
      const scale = Math.max(2, rank.hs * 0.18);      // natural upper spread proxy
      const RF = delta <= 0 ? 0 : clamp(delta / scale, 0, 4);
      const ssK = logistic(st.kills, 8, 3);
      const af = clamp(1 + (AGENT_MEAN_HS - st.avgHS) / AGENT_MEAN_HS * 0.6, 0.75, 1.30);
      const soft = RF * 22 * ssK * af;
      S = clamp(soft, 0, 60);
      if (RF >= 1.5) reasons.push(`Headshot ${round(st.hsPct * 100)}% is ${RF >= 3 ? 'wildly' : 'well'} above ${rank.name} norm (${rank.hs}%)`);
    }

    // rank-invariant HARD caps on other tells (KD/ACS/first-blood survive)
    let hardExtra = 0;
    if (st.kd > 1.6) {
      const add = clamp((st.kd - 1.6) * 22, 0, 26) * (0.55 + 0.45 * logistic(st.deaths, 12, 4));
      hardExtra += add;
      if (st.kd > 2.2 && st.deaths >= 12) reasons.push(`KD ${st.kd.toFixed(2)} over ${st.deaths} deaths — demon hours`);
    }
    if (st.scorePerRound > 11) {
      const add = clamp((st.scorePerRound - 11) / 7 * 20, 0, 20);
      hardExtra += add;
      if (st.scorePerRound > 15) reasons.push(`Combat score ${round(st.scorePerRound)}/round — statline of a demon`);
    }
    if (st.fbRate > 0.22) {
      const survive2 = clamp(1 - (st.deaths / Math.max(st.rounds, 1)) / 0.5, 0, 1);
      const add = clamp((st.fbRate - 0.22) * 70, 0, 16) * (0.5 + 0.5 * survive2);
      hardExtra += add;
      if (st.fbRate > 0.30 && survive2 > 0.5) reasons.push(`${round(st.fbRate * 100)}% first-bloods AND lived — always first to peek`);
    }
    if (st.deaths > 0 && st.dmgDealt / st.deaths > 250) hardExtra += clamp((st.dmgDealt / st.deaths - 250) / 12, 0, 10);
    if (st.kills >= 20 && st.deaths <= 2 && st.rounds >= 20) { hardExtra += 12; reasons.push(`${st.kills} kills, ${st.deaths} deaths over ${st.rounds} rounds — untouchable`); }
    hardExtra = clamp(hardExtra, 0, 100);
    H = clamp(H + hardExtra, 0, 100);
    const hardPresent = H > 40;

    // SMURF is NOT a separate discount on cheater% — it's a LABEL for the same
    // suspicion (playing clearly above your own rank, no hard tells). The cheater
    // % stays honest; smurf just re-classifies *why* the bar is high.
    const smurf = smurfScore(st, rankTierId);

    // cheater %: HARD tells + SOFT rank-relative HS, with NO smurf suppression.
    let pct = clamp(round(5 + S + (hardPresent ? H * 0.6 : 0) + vibeJitter(st.puuid + st.name)), 0, 99);
    if (hardPresent) pct = clamp(round(20 + H * 0.7 + vibeJitter(st.puuid + st.name)), 0, 99);

    // Type: what KIND of suspicion is this?
    // A smurf is clearly above their OWN rank (>=50% = ~3+ divisions up). Below
    // that, a player is just a REGULAR player in their rank — give them a funny
    // "regular" tag instead of lumping them as a smurf or a suspect.
    let type = 'fine';
    if (hardPresent || pct >= 85) type = 'cheater';
    else if (smurf >= 0.50) type = 'smurf';
    else if (pct >= 45) type = 'sus';
    else type = 'fine';

    return { pct, reasons, smurfPct: round(smurf * 100), hardPresent, type };
  }

  // ---- SMURF score --------------------------------------------------
  // A smurf is someone playing CLEARLY ABOVE the average player in THEIR OWN
  // rank — i.e. their HS% / ACS sit several tiers above their rank's median.
  // KD is NOT used: KD median is flat (~1.0) across all ranks, so a normal
  // positive-KD player would falsely imply "top tier". We measure deviation
  // from the player's own rank baseline, in rank-tier units.
  function smurfScore(st, rankTierId) {
    const rank = rankById(rankTierId || 0);
    // Ladder spacing per single TIER (3 tiers = 1 rank division).
    const hsStep = (RANKS[RANKS.length - 1].hs - RANKS[0].hs) / (RANKS.length - 2);
    const acsStep = (RANKS[RANKS.length - 1].acs - RANKS[0].acs) / (RANKS.length - 2);
    // Deviation from the player's OWN rank median, expressed in RANK DIVISIONS
    // (1 division = 3 tiers). A smurf plays like they belong ~2.5+ divisions
    // above their rank — i.e. basically a whole rank bracket up. One good match
    // is NOT proof (Riot stresses career patterns), so modest above-rank play
    // stays low and only clearly-above-rank play reads high.
    const gHS = (st.hsPct * 100 - rank.hs) / hsStep / 3;
    const gACS = (st.scorePerRound * 13 - rank.acs) / acsStep / 3;
    const S = 0.55 * Math.max(0, gHS) + 0.45 * Math.max(0, gACS);
    // Center at 2.5 divisions: a normal-good player (1 div up) reads ~9%, only
    // ~3+ divisions above rank crosses 50%.
    const smurf = clamp(sigmoid((S - 2.5) / 0.8) * 0.9, 0, 0.95);
    return clamp(smurf, 0, 1);
  }
  function rankIndex(id) {
    if (id == null) return 4; // default ~Gold
    const r = RANKS.find((x) => x.id === id);
    if (r) return RANKS.indexOf(r) - 1; // 0..8
    return 4;
  }

  // ---- THROWER (rank-factor aware, with JUST-BAD guard) -------------
  function throwerScore(st, rankTierId) {
    const duelRole = st.agentRole === 'duelist';
    const s_afk = clamp((st.scorePerRound < 4 ? 1 : 0) + (st.dmgDealt < 50 ? 0.7 : 0), 0, 1);
    const s_kd = clamp((0.6 - st.kd) / 0.6, 0, 1) * (st.kills <= 12 ? 1 : 0.5);
    const s_dmg = st.dmgDealt > 0 ? clamp((st.dmgRecv / st.dmgDealt - 1.8) / 1.0, 0, 1) : 0;
    const s_fd = clamp((st.deaths / Math.max(st.rounds, 1) - 0.6) / 0.4, 0, 1) * (s_kd > 0.4 ? 1 : 0.3);
    let raw = 30 * s_afk + 30 * s_kd + 20 * s_dmg + 20 * s_fd;

    const acs = st.scorePerRound * 13;
    const justBad = st.hsPct < 0.10 && st.kills <= 10 && acs < 150;
    let label = '';
    if (justBad && st.kills <= 10) { raw *= 0.18; label = 'JUST BAD'; }
    else if (raw >= 40) label = 'THROWER';
    else { raw *= 0.6; label = 'WEAK'; }

    const rf = rankFactor(rankIndex(rankTierId) + 1); // rankIndex 0..8 -> r 1..9
    const finalPts = clamp(raw * rf, 0, 100);

    const reasons = [];
    if (s_afk >= 0.5) reasons.push('Near-zero score and damage — barely participating');
    if (s_kd > 0.3 && st.kills <= 12) reasons.push(`KD ${st.kd.toFixed(2)}, only ${st.kills} kills — feeding, not finishing`);
    if (s_dmg > 0.5) reasons.push('Taking way more damage than dealing');
    if (s_fd > 0.3) reasons.push(`Dies first a lot (${round(st.deaths / Math.max(st.rounds, 1) * 100)}% of rounds)${duelRole ? ' — but duelists do' : ''}`);
    if (justBad) reasons.push('Low HS%, few kills, low impact — looks inept, not malicious');
    if (rankIndex(rankTierId) <= 2 && label !== 'JUST BAD') reasons.push('Low rank — could just be learning');

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
    if (c.hardPresent || c.pct >= 85) return 'CHEATER VIBES';
    if (c.type === 'smurf') return 'SMURF VIBES';
    if (c.pct >= 45) return 'LOOKING SUS';
    return regularTag(st.name).toUpperCase(); // e.g. REGULAR ANDY
  }

  function analyzeMatch(raw, myPuuid, rankTierId) {
    const { rounds, teams, players } = parseMatch(raw);
    const tier = rankTierId != null ? rankTierId : (raw && raw.rankTierId != null ? raw.rankTierId : 0);
    const rank = rankById(tier);
    const verdicts = players.map((st) => {
      const c = cheaterScore(st, tier);
      const t = throwerScore(st, tier);
      return {
        ...st, rankTierName: rank.name,
        cheaterPct: c.pct, throwerPct: t.pct, smurfPct: c.smurfPct,
        cheaterType: c.type, cheaterHardPresent: c.hardPresent,
        regularTag: c.type === 'fine' ? regularTag(st.name) : '',
        cheaterReasons: c.reasons, throwerReasons: t.reasons,
        throwerLabel: t.label,
        cheaterVerdict: cheaterVerdict(c.pct),
        throwerVerdict: throwerVerdict(t.pct, t.label),
        headline: headline(st, c, t),
        isEnemy: myPuuid ? st.team !== (players.find((x) => x.puuid === myPuuid) || {}).team : true,
      };
    });
    return { rounds, teams, rank: rank.name, players: verdicts };
  }

  const api = { analyzeMatch, parseMatch, cheaterScore, throwerScore, smurfScore, cheaterVerdict, throwerVerdict, agentInfo, rankById, RANKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AreTheyCheating = api;
})(typeof window !== 'undefined' ? window : globalThis);

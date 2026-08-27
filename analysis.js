/*
 * Are They Cheating? — analysis engine
 * ------------------------------------------------------------
 * Pure, dependency-free heuristics that turn a Valorant match's
 * per-player stats into a COMEDIC "cheating suspicion %" and a
 * "throwing suspicion %". This is SATIRE / vibes — it cannot and
 * does not actually detect cheating. For entertainment only.
 *
 * Works in the browser (attaches to window.AreTheyCheating) and
 * in Node (module.exports) so we can unit-test it here.
 */
(function (root) {
  'use strict';

  // ---- small helpers -------------------------------------------------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const round = (n) => Math.round(n);

  // Deterministic ±5 "vibe" jitter from a string so the same account
  // gives a stable-but-not-robotic reading. Purely cosmetic.
  function vibeJitter(str) {
    let h = 0;
    for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000;
    return (h % 11) - 5; // -5..+5
  }

  // ---- parsing -------------------------------------------------------
  // Accepts the full Riot match-details object OR a trimmed/renamed
  // shape. Tolerant of missing fields.
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

      return {
        puuid: p.puuid || '',
        name: p.gameName || p.name || (p.puuid ? 'Unknown' : 'Unknown'),
        tag: p.tagLine || '',
        agent: p.characterId || p.agent || '',
        team: p.teamId || p.team || '',
        premade: !!p.premade,
        kills, deaths, assists, score,
        hs, bs, ls, totalShots,
        dmgDealt, dmgRecv, fb,
        kd, hsPct, fbRate, scorePerRound, dmgPerRound,
      };
    });

    return { rounds, teams, players: list };
  }

  // ---- scoring -------------------------------------------------------
  function cheaterScore(st) {
    let pts = 0;
    const reasons = [];

    // Headshot percentage: 30% is already very good. Above that = sus.
    if (st.hsPct > 0.30) {
      const add = clamp((st.hsPct - 0.30) / 0.40 * 32, 0, 32);
      pts += add;
      if (st.hsPct > 0.45) reasons.push(`Headshot ${round(st.hsPct * 100)}% — aiming like a laser`);
    }
    // Kill/death: a 2.0+ KD in a real match is rare.
    if (st.kd > 1.6) {
      const add = clamp((st.kd - 1.6) * 22, 0, 26);
      pts += add;
      if (st.kd > 2.2) reasons.push(`KD ${st.kd.toFixed(2)} — statistically improbable`);
    }
    // Combat score per round: total score / rounds. ~13 is average, 16+ is "demon"
    if (st.scorePerRound > 11) {
      const add = clamp((st.scorePerRound - 11) / 7 * 20, 0, 20);
      pts += add;
      if (st.scorePerRound > 15) reasons.push(`Combat score ${round(st.scorePerRound)}/round — demon hours`);
    }
    // First-blood rate: entries every round = pre-aiming through walls
    if (st.fbRate > 0.22) {
      const add = clamp((st.fbRate - 0.22) * 70, 0, 16);
      pts += add;
      if (st.fbRate > 0.30) reasons.push(`${round(st.fbRate * 100)}% first-bloods — always first to peek`);
    }
    // Flawless: lots of kills, near-zero deaths
    if (st.kills >= 20 && st.deaths <= 2) {
      pts += 14;
      reasons.push(`${st.kills} kills, ${st.deaths} deaths — untouchable`);
    }
    // Damage output
    if (st.dmgPerRound > 200) {
      pts += clamp((st.dmgPerRound - 200) / 10, 0, 12);
    }

    const pct = clamp(round(5 + pts + vibeJitter(st.puuid + st.name)), 0, 99);
    return { pct, reasons };
  }

  function throwerScore(st) {
    let pts = 0;
    const reasons = [];

    if (st.kd < 0.6) {
      const add = clamp((0.6 - st.kd) * 45, 0, 34);
      pts += add;
      if (st.kd < 0.4) reasons.push(`KD ${st.kd.toFixed(2)} — feeding arc`);
    }
    if (st.scorePerRound < 6) {
      pts += clamp((6 - st.scorePerRound) / 0.2, 0, 24);
      if (st.scorePerRound < 4) reasons.push(`Combat score ${round(st.scorePerRound)}/round — AFK-ish`);
    }
    // Taking damage but dealing none = standing in fire
    if (st.dmgDealt > 0 && st.dmgRecv / Math.max(st.dmgDealt, 1) > 1.8) {
      pts += 14;
      reasons.push('Glass cannon in reverse — taking way more than dealing');
    }
    if (st.deaths >= 20 && st.kills <= 10) {
      pts += 10;
      reasons.push(`${st.deaths} deaths, ${st.kills} kills — ticket to the shadow realm`);
    }
    // AFK / literally not playing: combat score per round near zero
    if (st.scorePerRound < 4) {
      pts += 20;
      reasons.push(`Combat score ${round(st.scorePerRound)}/round — were you even there?`);
    }

    const pct = clamp(round(3 + pts + vibeJitter(st.name + 'throw')), 0, 99);
    return { pct, reasons };
  }

  function cheaterVerdict(pct) {
    if (pct >= 85) return '🚨 99% SUS — uninstall, touch grass, seek help';
    if (pct >= 65) return '😳 Shadows are moving… someone sees through walls';
    if (pct >= 45) return '🤔 Suspicious, but could just be cracked';
    if (pct >= 25) return '🫤 Probably just good';
    return '✅ Clean (this time)';
  }

  function throwerVerdict(pct) {
    if (pct >= 70) return '🎭 Full throw arc — feeding for content';
    if (pct >= 45) return '🪦 Might be throwing / having a rough one';
    if (pct >= 25) return '🎯 Playing normal-ish';
    return '🎯 Playing normal';
  }

  // Top-line label for the card
  function headline(st, c, t) {
    if (t.pct >= 70) return 'THROWER DETECTED';
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
        cheaterVerdict: cheaterVerdict(c.pct),
        throwerVerdict: throwerVerdict(t.pct),
        headline: headline(st, c, t),
        isEnemy: myPuuid ? st.team !== (players.find((x) => x.puuid === myPuuid) || {}).team : true,
      };
    });

    return { rounds, teams, players: verdicts };
  }

  const api = { analyzeMatch, parseMatch, cheaterScore, throwerScore, cheaterVerdict, throwerVerdict };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AreTheyCheating = api;
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * signals.js — pure statistical signals for one player
 * ----------------------------------------------------
 * Each function takes (playerStats, rankBaseline, trend?) and returns:
 *   { value, sigma, confidence, reasons[], flags[] }
 *
 * No hard-coded verdict thresholds here — just math + explanations.
 * Verdict combination lives in verdict.js.
 *
 * Inputs (player):
 *   { kills, deaths, assists, score, headshots, bodyshots, legshots,
 *     damageDealt, damageReceived, firstBloods, rounds, agent, agentRole,
 *     rankTierId }
 *
 * Trend (optional) from history:
 *   { hsAvg, acsAvg, kdAvg, n }
 */

const { sigma, agentHsMod } = require('./baselines');

// ---- Confidence ----
// How sure can we be about a single game? Small samples = low confidence.
// Returns 0..1; >= 0.7 = high confidence.
function confidenceForGame(p) {
  const kills = p.kills || 0;
  const rounds = p.rounds || 24;
  // 20+ kills in 20+ rounds = high signal. <10 kills or <15 rounds = noise.
  const killConf = Math.min(1, kills / 20);
  const roundConf = Math.min(1, rounds / 22);
  // Bonus if they survived long enough to have meaningful interactions
  const survival = p.deaths < rounds * 0.8 ? 1 : 0.6;
  return Math.max(0.05, Math.min(1, (killConf * 0.55 + roundConf * 0.45) * survival));
}

function fmt1(n) { return Math.round(n * 10) / 10; }
function fmt2(n) { return Math.round(n * 100) / 100; }

// ---- HEADSHOT signal ----
function hsSignal(p, rank) {
  const total = (p.headshots || 0) + (p.bodyshots || 0) + (p.legshots || 0);
  const hsPct = total ? (p.headshots / total) * 100 : 0;
  const rawSigma = sigma(hsPct, rank.hs, rank.hsSigma);
  // Agent modifier: Jett's 30% HS at Gold is less sus than Brimstone's 30% at Gold
  const adj = rawSigma + agentHsMod(p.agent);
  const conf = confidenceForGame(p);
  const reasons = [];
  if (Math.abs(adj) >= 2.0) reasons.push(`HS% ${fmt1(hsPct)} is ${fmt1(Math.abs(adj))}σ ${adj > 0 ? 'above' : 'below'} ${rank.name} median (${fmt1(rank.hs)}% ± ${fmt1(rank.hsSigma)})`);
  else if (Math.abs(adj) >= 1.3) reasons.push(`HS% ${fmt1(hsPct)} is ${fmt1(Math.abs(adj))}σ ${adj > 0 ? 'above' : 'below'} ${rank.name} median`);
  return {
    metric: 'hs', value: hsPct, rawSigma, sigma: adj, confidence: conf,
    agentMod: agentHsMod(p.agent),
    reasons,
    flag: adj >= 2.5 ? 'cheater' : adj >= 1.5 ? 'sus' : 'fine',
  };
}

// ---- ACS signal (Average Combat Score per round) ----
function acsSignal(p, rank) {
  const acs = p.acs || ((p.score || 0) / Math.max(p.rounds || 1, 1));
  const rawSigma = sigma(acs, rank.acs, rank.acsSigma);
  const conf = confidenceForGame(p);
  const reasons = [];
  if (rawSigma >= 2.0) reasons.push(`ACS ${Math.round(acs)} is ${fmt1(rawSigma)}σ above ${rank.name} median (${Math.round(rank.acs)} ± ${Math.round(rank.acsSigma)})`);
  return {
    metric: 'acs', value: acs, rawSigma, sigma: rawSigma, confidence: conf,
    reasons,
    flag: rawSigma >= 2.5 ? 'cheater' : rawSigma >= 1.5 ? 'sus' : 'fine',
  };
}

// ---- KD signal (kills per death) ----
// Note: KD median is FLAT across ranks (~1.0). A high KD matters less than a high HS/ACS.
function kdSignal(p, rank) {
  const kd = p.deaths === 0 ? (p.kills || 0) : (p.kills || 0) / p.deaths;
  const rawSigma = sigma(kd, rank.kd, rank.kdSigma);
  const conf = confidenceForGame(p);
  const reasons = [];
  if (rawSigma >= 1.8) reasons.push(`KD ${fmt2(kd)} is ${fmt1(rawSigma)}σ above ${rank.name} norm`);
  return {
    metric: 'kd', value: kd, rawSigma, sigma: rawSigma, confidence: conf,
    reasons,
    flag: rawSigma >= 2.0 ? 'sus' : 'fine',
  };
}

// ---- DAMAGE signal ----
function dmgSignal(p) {
  const rounds = p.rounds || 1;
  const dpr = (p.damageDealt || 0) / rounds;
  // expected ~140-180 dpr for typical rank, ~250+ is exceptional
  // express in sigma terms against a flat baseline since dmg/round varies less by rank
  const baseline = 160;
  const sigmaVal = sigma(dpr, baseline, 40);
  const conf = confidenceForGame(p);
  const reasons = [];
  if (sigmaVal >= 2.0) reasons.push(`Damage/round ${Math.round(dpr)} is ${fmt1(sigmaVal)}σ above the typical 160`);
  return {
    metric: 'dmg', value: dpr, rawSigma: sigmaVal, sigma: sigmaVal, confidence: conf,
    reasons,
    flag: sigmaVal >= 2.5 ? 'cheater' : sigmaVal >= 1.8 ? 'sus' : 'fine',
  };
}

// ---- FIRST-DEATH signal (dying first a lot) ----
// Strong thrower indicator: dying first repeatedly = feeding.
function firstDeathSignal(p) {
  const rounds = p.rounds || 1;
  const fdRate = (p.firstDeaths || 0) / rounds;
  // typical first-death rate ~25-35%
  const baseline = 0.30;
  const sigmaVal = sigma(fdRate * 100, baseline * 100, 12);
  const conf = confidenceForGame(p);
  const reasons = [];
  if (sigmaVal >= 1.5) reasons.push(`Dies first ${Math.round(fdRate * 100)}% of rounds (${fmt1(sigmaVal)}σ above the typical 30%)`);
  return {
    metric: 'firstDeath', value: fdRate, rawSigma: sigmaVal, sigma: sigmaVal, confidence: conf,
    reasons,
    flag: sigmaVal >= 2.0 ? 'thrower' : sigmaVal >= 1.3 ? 'sus_throw' : 'fine',
  };
}

// ---- DAMAGE-TAKEN vs DEALT signal ----
// Active thrower signature: takes way more damage than they deal.
function dmgBalanceSignal(p) {
  const dealt = p.damageDealt || 0;
  const taken = p.damageReceived || 0;
  if (dealt + taken === 0) return { metric: 'dmgBalance', value: 1, rawSigma: 0, sigma: 0, confidence: 0.1, reasons: [], flag: 'fine' };
  const ratio = taken / Math.max(dealt, 1);
  // typical ratio 0.9-1.2 (taking ~what you deal). >2.0 = feeding hard.
  const sigmaVal = sigma(ratio, 1.0, 0.45);
  const conf = confidenceForGame(p);
  const reasons = [];
  if (sigmaVal >= 1.5) reasons.push(`Takes ${fmt2(ratio)}× as much damage as dealt — feeding`);
  return {
    metric: 'dmgBalance', value: ratio, rawSigma: sigmaVal, sigma: sigmaVal, confidence: conf,
    reasons,
    flag: sigmaVal >= 2.0 ? 'thrower' : sigmaVal >= 1.3 ? 'sus_throw' : 'fine',
  };
}

// ---- AFK signal (zero participation) ----
function afkSignal(p) {
  const rounds = p.rounds || 1;
  const scorePerRound = (p.score || 0) / rounds;
  const dmgPerRound = (p.damageDealt || 0) / rounds;
  const afkScore = scorePerRound < 3 && dmgPerRound < 30 ? 1 : 0;
  const conf = rounds >= 15 ? 1 : 0.5;
  const reasons = [];
  if (afkScore) reasons.push(`Near-zero score (${fmt1(scorePerRound)}/rd) and damage (${Math.round(dmgPerRound)}/rd) — barely participating`);
  return {
    metric: 'afk', value: afkScore, rawSigma: afkScore * 5, sigma: afkScore * 5, confidence: conf,
    reasons,
    flag: afkScore ? 'thrower' : 'fine',
  };
}

// ---- TREND-drop signal ----
// Strong thrower evidence: player's ACS/KD suddenly way below their 10-game average.
// Bad players are CONSISTENTLY bad. Throwers have a sudden drop.
function trendDropSignal(p, trend) {
  if (!trend || trend.n < 5) return { metric: 'trendDrop', value: 0, rawSigma: 0, sigma: 0, confidence: 0.1, reasons: [], flag: 'fine', available: false };
  const acsDrop = trend.acsAvg > 0 ? (trend.acsAvg - (p.acs || 0)) / Math.max(trend.acsSigma || 60, 30) : 0;
  const kdDrop = trend.kdAvg > 0 ? (trend.kdAvg - ((p.kills || 0) / Math.max(p.deaths || 1, 1))) / Math.max(trend.kdSigma || 0.4, 0.2) : 0;
  // Combine: drop needs to be in BOTH metrics to count (or one extreme)
  const combined = acsDrop > 0 && kdDrop > 0 ? Math.min(acsDrop, kdDrop) : Math.max(acsDrop, kdDrop) * 0.5;
  const reasons = [];
  if (combined >= 1.5) reasons.push(`ACS ${Math.round(p.acs || 0)} is ${fmt1(acsDrop)}σ below this player's 10-game average (${Math.round(trend.acsAvg)})`);
  if (combined >= 1.5 && kdDrop >= 1.0) reasons.push(`KD also dropped from their average of ${fmt2(trend.kdAvg)} — consistent drop, not a bad game`);
  return {
    metric: 'trendDrop', value: combined, rawSigma: combined, sigma: combined, confidence: 0.8,
    reasons,
    flag: combined >= 2.0 ? 'thrower' : combined >= 1.3 ? 'sus_throw' : 'fine',
    available: true,
    acsDrop, kdDrop,
  };
}

// ---- TREND-spike signal ----
// Mirrors drop signal but UPWARD — used to detect one-off cheat/smurf games vs patterns.
function trendSpikeSignal(p, trend) {
  if (!trend || trend.n < 5) return { metric: 'trendSpike', value: 0, rawSigma: 0, sigma: 0, confidence: 0.1, reasons: [], flag: 'fine', available: false };
  const acsSpike = ((p.acs || 0) - trend.acsAvg) / Math.max(trend.acsSigma || 60, 30);
  const hsSpike = ((p.hsPct || 0) * 100 - trend.hsAvg) / Math.max(trend.hsSigma || 8, 4);
  const combined = Math.max(acsSpike, hsSpike);
  const reasons = [];
  if (combined >= 1.5) reasons.push(`HS/ACS ${fmt1(Math.max(combined))}σ above this player's 10-game average — could be a one-off`);
  return {
    metric: 'trendSpike', value: combined, rawSigma: combined, sigma: combined, confidence: 0.8,
    reasons,
    flag: combined >= 2.0 ? 'one_off_spike' : 'fine',
    available: true,
    acsSpike, hsSpike,
  };
}

// ---- Composite signal: collect all signals for a player ----
function allSignals(p, rank, trend) {
  const sigs = {
    hs: hsSignal(p, rank),
    acs: acsSignal(p, rank),
    kd: kdSignal(p, rank),
    dmg: dmgSignal(p),
    firstDeath: firstDeathSignal(p),
    dmgBalance: dmgBalanceSignal(p),
    afk: afkSignal(p),
    trendDrop: trendDropSignal(p, trend),
    trendSpike: trendSpikeSignal(p, trend),
  };
  // overall confidence = best-supported signal (max), penalized by game-confidence
  const gameConf = confidenceForGame(p);
  sigs.gameConfidence = gameConf;
  return sigs;
}

module.exports = {
  confidenceForGame,
  hsSignal, acsSignal, kdSignal, dmgSignal,
  firstDeathSignal, dmgBalanceSignal, afkSignal,
  trendDropSignal, trendSpikeSignal, allSignals,
};

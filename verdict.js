/*
 * verdict.js — combine signals into cheater / smurf / thrower / fine
 * ------------------------------------------------------------------
 * Each player gets a { type, pct, confidence, reasons[] }.
 *
 * Rules of thumb (NOT magic numbers — these are principled):
 *   - Strong agreement across multiple metrics at sigma >= 2 = high suspicion.
 *   - Trend available + big drop = thrower (not just "bad game").
 *   - Trend available + big spike on one metric but normal on others = one-off, downgrade.
 *   - Low game-confidence (few kills/rounds) down-weights everything.
 *
 * Sigma → suspicion:
 *   sigma >= 3.0 across 2+ metrics → very strong (>= 85% cheater)
 *   sigma >= 2.5 across 2+ metrics → strong (>= 70% cheater or smurf)
 *   sigma >= 2.0 single metric       → moderate (sus or smurf)
 *   sigma >= 1.5 single metric       → weak (LOOKING SUS)
 *   all metrics < 1.5 sigma           → fine
 */

const { allSignals } = require('./signals');
const { rankFor } = require('./baselines');

// Which signals count as "abnormal" for cheater/smurf (UPWARD direction matters)
const CHEATER_UP = ['hs', 'acs', 'dmg'];
// KD is weaker alone — only counts when paired with another metric
const CHEATER_UP_WEAK = ['kd'];

function regularTag(name) { return 'Average Jonas'; }

function weightedSuspicion(sigs, metricList, opts) {
  // For each metric, take its sigma (UP direction only). Weight by confidence.
  // Return combined [0..1] = fraction of strong-evidence support.
  opts = opts || {};
  const minSigma = opts.minSigma || 1.5;
  let totalWeight = 0, sigSum = 0;
  metricList.forEach((m) => {
    const s = sigs[m];
    if (!s) return;
    const up = Math.max(0, s.sigma);
    if (up < minSigma) return;
    const w = (s.confidence || 0.5);
    sigSum += up * w;
    totalWeight += w;
  });
  if (totalWeight === 0) return { score: 0, count: 0 };
  return { score: sigSum / totalWeight, count: metricList.length };
}

function classify(sigs, p, trend, rank) {
  const reasons = [];

  // ---- THROWER ----
  // Strong evidence: trend-drop + first-death + dmg-balance agree
  // OR: AFK is unambiguous.
  let throwerScore = 0;
  let throwerReasons = [];
  const afk = sigs.afk;
  if (afk.flag === 'thrower') {
    throwerScore = Math.max(throwerScore, 0.95);
    throwerReasons.push(...afk.reasons);
  }
  const drop = sigs.trendDrop;
  const fd = sigs.firstDeath;
  const dmgBal = sigs.dmgBalance;

  // Only count dmgBalance as a thrower signal if the player is ALSO taking
  // a lot of damage relative to rounds (i.e. actively feeding). A bad player
  // with low overall damage doesn't have a meaningful ratio.
  const dmgPerRound = (p.damageDealt || 0) / Math.max(p.rounds || 1, 1);
  const dmgBalValid = dmgPerRound >= 80 && dmgBal.flag !== 'fine';

  let throwerAgreement = 0;
  if (drop.flag === 'thrower' || drop.flag === 'sus_throw') throwerAgreement++;
  if (fd.flag === 'thrower' || fd.flag === 'sus_throw') throwerAgreement++;
  if (dmgBalValid) throwerAgreement++;

  if (drop.flag === 'thrower' && throwerAgreement >= 1) {
    throwerScore = Math.max(throwerScore, 0.85);
    throwerReasons.push(...drop.reasons);
  } else if (drop.flag === 'sus_throw' && throwerAgreement >= 2) {
    throwerScore = Math.max(throwerScore, 0.7);
    throwerReasons.push(...drop.reasons);
  } else if (throwerAgreement >= 2) {
    throwerScore = Math.max(throwerScore, 0.6);
    [drop, fd, dmgBal].forEach((s) => { if (s.flag !== 'fine') throwerReasons.push(...s.reasons); });
  } else if (throwerAgreement === 1 && !trend) {
    // No trend available — single thrower signal is weaker
    throwerScore = Math.max(throwerScore, 0.35);
  }

  // ---- CHEATER vs SMURF ----
  // Cheater: extreme + multiple metrics agree at high sigma
  // Smurf: above-rank but no extreme single-metric tell
  const cheatUp = weightedSuspicion(sigs, CHEATER_UP, { minSigma: 1.5 });
  const cheatUpStrong = weightedSuspicion(sigs, CHEATER_UP, { minSigma: 2.0 });
  const cheatUpWeak = weightedSuspicion(sigs, CHEATER_UP_WEAK, { minSigma: 1.8 });

  const spike = sigs.trendSpike;
  const hs = sigs.hs;
  const acs = sigs.acs;

  let type = 'fine';
  let pct = 0;
  let cheaterReasons = [];

  // Does the player sit way above their rank on 2+ metrics?
  const strongMetrics = CHEATER_UP.filter((m) => (sigs[m].sigma || 0) >= 2.0).length;
  const mediumMetrics = CHEATER_UP.filter((m) => (sigs[m].sigma || 0) >= 1.5).length;

  // Cheater bar: needs extreme agreement
  if (strongMetrics >= 2 && cheatUpStrong.score >= 2.3) {
    type = 'cheater';
    pct = Math.min(95, 70 + (cheatUpStrong.score - 2.3) * 12);
    cheaterReasons = CHEATER_UP.filter((m) => sigs[m].sigma >= 1.5).map((m) => sigs[m].reasons).flat();
  } else if (mediumMetrics >= 2 && cheatUp.score >= 1.8) {
    // Smurf: above-rank across multiple metrics but not extreme on any one
    type = 'smurf';
    pct = Math.min(85, 50 + (cheatUp.score - 1.8) * 25);
    cheaterReasons = CHEATER_UP.filter((m) => sigs[m].sigma >= 1.3).map((m) => sigs[m].reasons).flat();
  } else if (mediumMetrics >= 1 && cheatUp.score >= 2.0) {
    // One strong metric: LOOKING SUS
    type = 'sus';
    pct = Math.min(70, 40 + (cheatUp.score - 2.0) * 30);
    cheaterReasons = CHEATER_UP.filter((m) => sigs[m].sigma >= 1.5).map((m) => sigs[m].reasons).flat();
  } else if (mediumMetrics >= 1 && cheatUp.score >= 1.5) {
    type = 'sus';
    pct = Math.min(50, 25 + (cheatUp.score - 1.5) * 30);
    cheaterReasons = CHEATER_UP.filter((m) => sigs[m].sigma >= 1.5).map((m) => sigs[m].reasons).flat();
  }

  // ---- TREND RECONCILIATION ----
  // Compare this game against the player's 10-game average. The question is:
  // is THIS game an outlier (one-off spike/down) or does the trend say the
  // player is CONSISTENTLY above their rank?
  if (trend && trend.n >= 5) {
    const spikeMag = spike.sigma || 0;
    const dropMag = drop.sigma || 0;
    // Is the trend itself above the rank's median? (sustained pattern)
    const trendAcsSigma = ((trend.acsAvg || 0) - rank.acs) / Math.max(rank.acsSigma, 1);
    const trendHsSigma = ((trend.hsAvg || 0) * 100 - rank.hs) / Math.max(rank.hsSigma, 1);
    const trendIsSus = trendAcsSigma > 1.5 || trendHsSigma > 1.5;

    // ONE-OFF SPIKE: this game is way above the trend → downgrade
    if ((type === 'cheater' || type === 'smurf') && spikeMag >= 2.0 && !trendIsSus) {
      type = 'sus';
      pct = Math.min(pct, 55);
      cheaterReasons.push(`But this is ${fmt1(spikeMag)}σ above their 10-game average (${Math.round(trend.acsAvg)} ACS / ${Math.round(trend.hsAvg*100)}% HS) — probably just a good game`);
    } else if (type === 'smurf' && spikeMag >= 1.5 && !trendIsSus) {
      type = 'fine';
      pct = Math.min(pct, 30);
      cheaterReasons.push(`Their 10-game avg (${Math.round(trend.acsAvg)} ACS, ${Math.round(trend.hsAvg*100)}% HS) is normal for ${rank.name} — this game is an outlier`);
    }

    // PATTERN: trend itself is sus → upgrade
    if (type === 'sus' && trendIsSus && spikeMag < 1.5) {
      type = 'smurf';
      pct = Math.max(pct, 60);
      cheaterReasons.push(`Pattern: 10-game avg ${Math.round(trend.acsAvg)} ACS / ${Math.round(trend.hsAvg*100)}% HS (${fmt1(Math.max(trendAcsSigma, trendHsSigma))}σ above ${rank.name}) — not a fluke`);
    } else if (type === 'fine' && trendIsSus) {
      type = 'smurf';
      pct = 55;
      cheaterReasons.push(`Pattern: 10-game avg ${Math.round(trend.acsAvg)} ACS / ${Math.round(trend.hsAvg*100)}% HS is ${fmt1(Math.max(trendAcsSigma, trendHsSigma))}σ above ${rank.name} — sustained above-rank`);
    }
  }

  // ---- CONFIDENCE ----
  // game confidence from sample size; verdict confidence from signal agreement.
  const gameConf = sigs.gameConfidence;
  let verdictConf = 0.5;
  if (type === 'cheater') verdictConf = Math.min(1, 0.6 + strongMetrics * 0.15);
  else if (type === 'smurf') verdictConf = Math.min(1, 0.55 + mediumMetrics * 0.1);
  else if (type === 'sus') verdictConf = 0.45;
  else verdictConf = 0.7; // fine is the confident default
  const confidence = Math.min(1, gameConf * 0.6 + verdictConf * 0.4);

  // ---- HEADLINE ----
  const headline = (() => {
    if (throwerScore >= 0.7 && throwerScore >= pct / 100) return 'THROWER DETECTED';
    if (type === 'cheater') return 'CHEATER VIBES';
    if (type === 'smurf') return 'SMURF VIBES';
    if (type === 'sus') return 'LOOKING SUS';
    return regularTag(p.name).toUpperCase();
  })();

  return {
    type, pct: Math.round(pct), confidence,
    cheaterReasons, throwerReasons,
    headline,
    throwerPct: Math.round(throwerScore * 100),
    signals: sigs,
  };
}

function fmt1(n) { return Math.round(n * 10) / 10; }

function analyzePlayer(p, rankTierId, trend) {
  const rank = rankFor(rankTierId);
  const sigs = allSignals(p, rank, trend);
  return classify(sigs, p, trend, rank);
}

module.exports = { analyzePlayer, classify, weightedSuspicion, regularTag };

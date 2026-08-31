/*
 * baselines.js — rank + agent statistical baselines
 * ----------------------------------------------------
 * Instead of hand-tuned thresholds ("HS >= 60% is cheater"), each player stat
 * is compared against the population distribution for their RANK and AGENT.
 * A player is suspicious by how many standard deviations (σ) they sit above
 * (or below) that distribution — pure math, no magic numbers.
 *
 * Numbers are mid-2026 public aggregates from Riot/Tracker.gg style sources,
 * normalized to per-rank medians and per-rank spread. Agent values shift the
 * baseline for players who naturally run higher/lower HS% on a given duelist.
 *
 * - medians: typical value at this rank
 * - sigma: typical within-rank spread (1 std dev)
 *
 * The engine asks "where does this player sit on the rank's normal curve?"
 * A HS% at 2.3σ above median is the same SUSPICIOUS no matter the rank.
 */

// ---- Rank baselines (HS%, KD, ACS) ----
// sigma = typical within-rank std dev. Wider at higher ranks because skill spread grows.
const RANK_BASELINES = {
  0:  { name: 'Unranked',   hs: 22.0, hsSigma: 6.0, kd: 1.00, kdSigma: 0.30, acs: 210, acsSigma: 50 },
  3:  { name: 'Iron',       hs: 11.0, hsSigma: 4.0, kd: 0.90, kdSigma: 0.30, acs: 207, acsSigma: 45 },
  6:  { name: 'Bronze',     hs: 18.5, hsSigma: 5.0, kd: 0.94, kdSigma: 0.30, acs: 204, acsSigma: 50 },
  9:  { name: 'Silver',     hs: 21.1, hsSigma: 5.5, kd: 0.99, kdSigma: 0.30, acs: 211, acsSigma: 52 },
  12: { name: 'Gold',       hs: 22.8, hsSigma: 6.0, kd: 1.03, kdSigma: 0.32, acs: 213, acsSigma: 55 },
  15: { name: 'Platinum',   hs: 25.2, hsSigma: 6.5, kd: 0.99, kdSigma: 0.32, acs: 216, acsSigma: 58 },
  18: { name: 'Diamond',    hs: 26.9, hsSigma: 7.0, kd: 1.01, kdSigma: 0.34, acs: 211, acsSigma: 62 },
  21: { name: 'Ascendant',  hs: 24.6, hsSigma: 7.0, kd: 1.01, kdSigma: 0.35, acs: 213, acsSigma: 65 },
  24: { name: 'Immortal',   hs: 29.0, hsSigma: 7.5, kd: 1.10, kdSigma: 0.38, acs: 280, acsSigma: 75 },
  27: { name: 'Radiant',    hs: 31.0, hsSigma: 7.0, kd: 1.20, kdSigma: 0.40, acs: 320, acsSigma: 80 },
};

// tierId 0..27; nearest-lower bracket interpolation if tier falls between named ranks
const RANK_TIERS = [3, 6, 9, 12, 15, 18, 21, 24, 27];

function rankFor(tierId) {
  tierId = tierId || 0;
  if (tierId <= 0 || tierId < RANK_TIERS[0]) return { id: tierId, ...RANK_BASELINES[0] };
  const exact = RANK_BASELINES[tierId];
  if (exact) return { id: tierId, ...exact };
  // interpolate between the two nearest named ranks
  const lower = RANK_TIERS.filter((t) => t <= tierId).pop();
  const upper = RANK_TIERS.find((t) => t >= tierId);
  if (lower === upper) return { id: tierId, ...RANK_BASELINES[lower] };
  const ratio = (tierId - lower) / (upper - lower);
  const a = RANK_BASELINES[lower], b = RANK_BASELINES[upper];
  return {
    id: tierId,
    name: a.name + '/' + b.name,
    hs: a.hs + ratio * (b.hs - a.hs),
    hsSigma: a.hsSigma + ratio * (b.hsSigma - a.hsSigma),
    kd: a.kd + ratio * (b.kd - a.kd),
    kdSigma: a.kdSigma + ratio * (b.kdSigma - a.kdSigma),
    acs: a.acs + ratio * (b.acs - a.acs),
    acsSigma: a.acsSigma + ratio * (b.acsSigma - a.acsSigma),
  };
}

// ---- Agent modifier ----
// Each agent shifts the expected HS% range. Jett/Chamber naturally higher; Gekko lower.
// Modifier = how many σ to ADD/SUBTRACT from the player's HS sigma reading.
// E.g. a Jett with 35% HS at Gold: gold median=22.8, sigma=6, so sigma = (35-22.8)/6 = 2.03.
//      Agent shift = -0.5 (Jett runs high), so adjusted sigma = 2.03 - 0.5 = 1.53.
const AGENT_HS_MOD = {
  // duelists naturally higher HS% (precision aim kit)
  'Jett':  -0.6,
  'Reyna': -0.5,
  'Raze':  +0.4, // explosive kit, body shots common
  'Phoenix':-0.3,
  'Yoru':  -0.5,
  'Neon':  -0.3,
  'Iso':   -0.4,
  // sentinels mix — Chamber awpy, others utility
  'Chamber':   -0.5,
  'Killjoy':   +0.1,
  'Cypher':    +0.2,
  'Sage':      +0.2,
  'Deadlock':  -0.2,
  'Vyse':      +0.0,
  // controllers — utility focus, slightly lower HS
  'Omen':      +0.1,
  'Brimstone': +0.1,
  'Viper':     +0.0,
  'Astra':     +0.0,
  'Harbor':    +0.1,
  'Clove':     +0.1,
  // initiators — utility + intel
  'Sova':      -0.3,
  'Fade':      -0.2,
  'Breach':    +0.0,
  'Gekko':     +0.3,
  'KAY/O':     +0.1,
  'Skye':      +0.0,
  'Tejo':      +0.1,
};
const AGENT_DEFAULT_HS_MOD = 0;

function agentHsMod(agentName) {
  if (!agentName) return AGENT_DEFAULT_HS_MOD;
  return AGENT_HS_MOD[agentName] != null ? AGENT_HS_MOD[agentName] : AGENT_DEFAULT_HS_MOD;
}

// ---- Sigma math ----
// How many standard deviations is `value` above/below `median`?
function sigma(value, median, std) {
  if (!std || std <= 0) return 0;
  return (value - median) / std;
}

module.exports = { rankFor, sigma, agentHsMod, RANK_BASELINES };

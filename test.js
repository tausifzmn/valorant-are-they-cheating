/*
 * test.js — engine unit tests
 * ---------------------------
 * Covers: baselines, signals, verdict, edge cases.
 */
'use strict';

const { rankFor, sigma, agentHsMod } = require('./baselines');
const sigs = require('./signals');
const { analyzePlayer, classify } = require('./verdict');
const A = require('./analysis');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  \u2713', label); }
  else { fail++; console.log('  \u2717', label, extra ? '\n     '+extra : ''); }
}
function section(name) { console.log('\n=== ' + name + ' ==='); }

// ---- BASELINES ----
section('BASELINES');
ok('rankFor returns numeric baseline for tier 15 (Plat)', rankFor(15).hs === 25.2);
ok('rankFor interpolates between Plat and Diamond for tier 16', rankFor(16).hs > 25.2 && rankFor(16).hs < 26.9);
ok('rankFor returns Unranked for tier 0', rankFor(0).name === 'Unranked');
ok('sigma(25.2, 25.2, 6.5) = 0', Math.abs(sigma(25.2, 25.2, 6.5)) < 0.001);
ok('sigma(38.2, 25.2, 6.5) \u2248 2', Math.abs(sigma(38.2, 25.2, 6.5) - 2) < 0.01);
ok('Jett has negative HS mod (-0.6) \u2014 high HS less sus', agentHsMod('Jett') === -0.6);
ok('Raze has positive HS mod (+0.4) \u2014 explosive kit', agentHsMod('Raze') === 0.4);

// ---- HS SIGNAL ----
section('HEADSHOT SIGNAL');
const plat = rankFor(15);
const hsRes = sigs.hsSignal({ headshots: 200, bodyshots: 210, legshots: 0, kills: 28, deaths: 19, rounds: 24, agent: 'Chamber' }, plat);
ok('49% HS at Plat Chamber: sigma > 3 (high)', hsRes.sigma > 3);
ok('HS signal includes reasoning', hsRes.reasons.length > 0);
const hsLowKills = sigs.hsSignal({ headshots: 50, bodyshots: 50, legshots: 0, kills: 5, deaths: 8, rounds: 24, agent: 'Gekko' }, plat);
ok('5 kills @ 50% HS \u2014 lower confidence', hsLowKills.confidence < sigs.hsSignal({ headshots: 200, bodyshots: 200, legshots: 0, kills: 28, deaths: 19, rounds: 24, agent: 'Chamber' }, plat).confidence);

// ---- ACS SIGNAL ----
section('ACS SIGNAL');
const acsHigh = sigs.acsSignal({ score: 410 * 24, kills: 28, deaths: 19, rounds: 24 }, plat);
ok('ACS 410 at Plat — sigma > 3 (very high)', acsHigh.sigma > 3);

// ---- THROWER SIGNAL ----
section('THROWER SIGNALS');
const afkP = { kills: 0, deaths: 5, assists: 0, score: 30, damageDealt: 80, damageReceived: 600, firstDeaths: 8, firstBloods: 0, rounds: 20 };
ok('AFK player flagged as thrower by afkSignal', sigs.afkSignal(afkP).flag === 'thrower');
const feedP = { kills: 4, deaths: 18, assists: 2, score: 800, damageDealt: 1200, damageReceived: 3800, firstDeaths: 12, firstBloods: 0, rounds: 22 };
ok('Heavy feeder: dmgBalance flag = thrower', sigs.dmgBalanceSignal(feedP).flag === 'thrower');
ok('Heavy feeder: firstDeath flag = thrower', sigs.firstDeathSignal(feedP).flag === 'thrower');

// ---- TREND-DROP ----
section('TREND-DROP SIGNAL');
const trend10 = { n: 10, hsAvg: 0.22, hsSigma: 0.05, acsAvg: 230, acsSigma: 50, kdAvg: 1.1, kdSigma: 0.3 };
const normalPlayer = { score: 230 * 24, acs: 230, kills: 18, deaths: 16, rounds: 24, hsPct: 0.22 };
const dropPlayer = { score: 80 * 24, acs: 80, kills: 4, deaths: 18, rounds: 24, hsPct: 0.10 };
ok('Player matching trend: drop sigma ~ 0', sigs.trendDropSignal(normalPlayer, trend10).sigma < 0.5);
ok('Player way below trend: drop sigma > 2', sigs.trendDropSignal(dropPlayer, trend10).sigma > 2);

// ---- VERDICT ----
section('VERDICT CLASSIFICATION');
const proPlayer = { kills: 28, deaths: 19, assists: 3, score: 410 * 24, acs: 410, headshots: 200, bodyshots: 210, legshots: 0, damageDealt: 5200, damageReceived: 3800, firstBloods: 6, firstDeaths: 3, rounds: 24, agent: 'Chamber', agentRole: 'sentinel', rankTierId: 15 };
const proVerdict = analyzePlayer(proPlayer, 15);
ok('49% HS / 410 ACS / Chamber Plat: type=cheater', proVerdict.type === 'cheater', 'got '+proVerdict.type);
ok('Pro verdict includes sigma reasoning', proVerdict.cheaterReasons.some((r) => r.includes('\u03c3')));

const avgPlayer = { kills: 15, deaths: 14, assists: 5, score: 220 * 24, headshots: 80, bodyshots: 340, legshots: 20, damageDealt: 3500, damageReceived: 3500, firstBloods: 2, firstDeaths: 5, rounds: 24, agent: 'Brimstone', agentRole: 'controller', rankTierId: 15 };
const avgVerdict = analyzePlayer(avgPlayer, 15);
ok('Avg Plat player: type=fine', avgVerdict.type === 'fine', 'got '+avgVerdict.type+' pct='+avgVerdict.pct);

const smurfGold = { kills: 25, deaths: 12, assists: 4, score: 330 * 24, headshots: 120, bodyshots: 280, legshots: 10, damageDealt: 4500, damageReceived: 2800, firstBloods: 5, firstDeaths: 2, rounds: 22, agent: 'Jett', agentRole: 'duelist', rankTierId: 12 };
const smurfVerdict = analyzePlayer(smurfGold, 12);
ok('Cracked Jett at Gold: type=smurf or cheater', ['smurf', 'cheater', 'sus'].includes(smurfVerdict.type), 'got '+smurfVerdict.type+' pct='+smurfVerdict.pct);

const smallSample = { kills: 3, deaths: 8, assists: 1, score: 30 * 24, headshots: 30, bodyshots: 20, legshots: 0, damageDealt: 350, damageReceived: 800, firstBloods: 0, firstDeaths: 3, rounds: 22, agent: 'Gekko', agentRole: 'initiator', rankTierId: 15 };
const ssVerdict = analyzePlayer(smallSample, 15);
ok('3 kills @ 45% HS \u2014 low confidence reading', ssVerdict.confidence < 0.5, 'got confidence='+ssVerdict.confidence);

// ---- TREND RECONCILIATION ----
section('TREND RECONCILIATION');
// Normal averages but this game spiked: downgrade
const oneOffSpike = { kills: 25, deaths: 12, headshots: 150, bodyshots: 150, legshots: 0, score: 380 * 24, acs: 380, damageDealt: 4800, damageReceived: 3000, firstBloods: 4, firstDeaths: 2, rounds: 24, agent: 'Chamber', agentRole: 'sentinel', rankTierId: 15 };
const consistentTrend = { n: 10, hsAvg: 0.22, hsSigma: 0.04, acsAvg: 230, acsSigma: 40, kdAvg: 1.1, kdSigma: 0.3 };
const spikeVerdict = analyzePlayer(oneOffSpike, 15, consistentTrend);
ok('One-off spike w/ normal trend: NOT cheater (downgraded)', spikeVerdict.type !== 'cheater', 'got '+spikeVerdict.type+' pct='+spikeVerdict.pct);

// Pattern: averages are sus + this game sus = sustained smurf
const sustained = { kills: 25, deaths: 14, headshots: 120, bodyshots: 200, legshots: 10, score: 320 * 24, acs: 320, damageDealt: 4200, damageReceived: 3000, firstBloods: 4, firstDeaths: 2, rounds: 24, agent: 'Chamber', agentRole: 'sentinel', rankTierId: 15 };
const susTrend = { n: 10, hsAvg: 0.34, hsSigma: 0.04, acsAvg: 310, acsSigma: 30, kdAvg: 1.4, kdSigma: 0.2 };
const susVerdict = analyzePlayer(sustained, 15, susTrend);
ok('Sustained above-rank pattern: type=smurf', susVerdict.type === 'smurf' || susVerdict.type === 'cheater', 'got '+susVerdict.type+' pct='+susVerdict.pct);

// ---- THROWER ----
section('THROWER VERDICT');
const badThrower = { kills: 2, deaths: 14, assists: 0, score: 90, damageDealt: 180, damageReceived: 1900, firstBloods: 0, firstDeaths: 9, rounds: 20, agent: 'Jett', agentRole: 'duelist', rankTierId: 15 };
const throwVerdict = analyzePlayer(badThrower, 15, { n: 10, hsAvg: 0.20, hsSigma: 0.05, acsAvg: 200, acsSigma: 40, kdAvg: 1.0, kdSigma: 0.3 });
ok('AFK/feeding player with trend drop: throwerPct >= 60', throwVerdict.throwerPct >= 60, 'got '+throwVerdict.throwerPct);

const badButConsistent = { kills: 8, deaths: 16, assists: 3, score: 130 * 22, acs: 130, damageDealt: 1500, damageReceived: 2800, firstBloods: 1, firstDeaths: 7, rounds: 22, agent: 'Sage', agentRole: 'sentinel', rankTierId: 15 };
const consistentBad = analyzePlayer(badButConsistent, 15, { n: 10, hsAvg: 0.14, hsSigma: 0.03, acsAvg: 130, acsSigma: 20, kdAvg: 0.5, kdSigma: 0.1 });
ok('Consistently bad player w/ trend: throwerPct low (NOT a thrower)', consistentBad.throwerPct < 40, 'got '+consistentBad.throwerPct);

// ---- BACKWARD COMPAT: old analysis.js still loads ----
section('BACKWARD COMPAT');
ok('analysis.js exports analyzeMatch', typeof A.analyzeMatch === 'function');
ok('analysis.js exports accumulateTrend', typeof A.accumulateTrend === 'function');

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED \u2705' : 'FAILED \u274c') + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);

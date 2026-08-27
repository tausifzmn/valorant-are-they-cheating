/*
 * Engine unit tests — research-backed sanity checks.
 * Run: node test.js
 */
const A = require('./analysis.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}

// Build a minimal raw match with one player.
function mk(stats, agent, rounds = 24) {
  return {
    info: {
      roundsPlayed: rounds,
      teams: [{ roundsPlayed: rounds }],
      players: [{
        puuid: 'p_' + (stats.name || 'x'),
        gameName: stats.name || 'Test',
        tagLine: 'TST',
        characterId: agent,
        teamId: 'Blue',
        stats: stats,
      }],
    },
  };
}
const AG = {
  raze: 'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc',
  jett: 'e370fa57-4757-3604-3648-499e1f642d3f',
  chamber: '462180ff-8be3-8a3c-e330-f2cdcee6c9da',
  vyse: '4a79e213-4997-29ca-9d4d-5943c25dfcf4',
  brim: '9f0d8ba9-4140-b941-57d3-a7ad57c6b417',
};

console.log('\n=== CHEATER: HS% band + kills-gate ===');
// Radiant-Jett 40% HS, 24 kills -> mild (old engine gave 99; new ~low)
{
  const r = A.analyzeMatch(mk({ kills: 24, deaths: 14, headshots: 270, bodyshots: 405, legshots: 0, score: 420, damageDealt: 3500, damageReceived: 3000, firstBloods: 6, assists: 5 }, AG.jett));
  const p = r.players[0];
  check('Radiant-Jett 40% HS reads LOW (cheat<35)', p.cheaterPct < 35, 'cheat=' + p.cheaterPct);
}
// Raze 58% HS, 22 kills -> suspect/high (agent amplifies)
{
  const r = A.analyzeMatch(mk({ kills: 22, deaths: 10, headshots: 406, bodyshots: 294, legshots: 0, score: 480, damageDealt: 4200, damageReceived: 2500, firstBloods: 8, assists: 4 }, AG.raze));
  const p = r.players[0];
  check('Raze 58% HS reads HIGH (cheat>=45)', p.cheaterPct >= 45, 'cheat=' + p.cheaterPct);
}
// 60% HS but only 5 kills -> sample gate kills it (should be low)
{
  const r = A.analyzeMatch(mk({ kills: 5, deaths: 8, headshots: 18, bodyshots: 12, legshots: 0, score: 90, damageDealt: 800, damageReceived: 1200, firstBloods: 1, assists: 1 }, AG.chamber));
  const p = r.players[0];
  check('60% HS on 5 kills is LOW (cheat<25)', p.cheaterPct < 25, 'cheat=' + p.cheaterPct);
}
// Flawless 38/2 but short 12-round game -> should NOT max (rounds gate)
{
  const r = A.analyzeMatch(mk({ kills: 38, deaths: 2, headshots: 200, bodyshots: 300, legshots: 0, score: 600, damageDealt: 5000, damageReceived: 600, firstBloods: 10, assists: 3 }, AG.vyse, 12));
  const p = r.players[0];
  check('Flawless on 12-round game does NOT read 99', p.cheaterPct < 99, 'cheat=' + p.cheaterPct);
}

console.log('\n=== THROWER vs JUST-BAD ===');
// JUST BAD: HS<10, few kills, low score/dmg, participated
{
  const r = A.analyzeMatch(mk({ kills: 8, deaths: 22, headshots: 12, bodyshots: 160, legshots: 0, score: 90, damageDealt: 1100, damageReceived: 4000, firstBloods: 2, assists: 1 }));
  const p = r.players[0];
  check('Inept low-HS low-kill player = JUST BAD', p.throwerLabel === 'JUST BAD', 'label=' + p.throwerLabel + ' throw=' + p.throwerPct);
  check('JUST BAD thrower% is low (<25)', p.throwerPct < 25, 'throw=' + p.throwerPct);
}
// THROWER: many first-deaths, low KD, few kills, non-duelist
{
  const r = A.analyzeMatch(mk({ kills: 4, deaths: 22, headshots: 40, bodyshots: 120, legshots: 0, score: 95, damageDealt: 900, damageReceived: 4200, firstBloods: 1, assists: 0 }, AG.brim));
  const p = r.players[0];
  check('Feed-heavy controller = THROWER', p.throwerLabel === 'THROWER', 'label=' + p.throwerLabel + ' throw=' + p.throwerPct);
}
// WEAK (not thrower): bad KD but normal deaths/round (passive, not feeding)
{
  const r = A.analyzeMatch(mk({ kills: 9, deaths: 18, headshots: 55, bodyshots: 200, legshots: 0, score: 140, damageDealt: 2200, damageReceived: 3000, firstBloods: 3, assists: 2 }));
  const p = r.players[0];
  check('Passive weak player (normal deaths/round) is WEAK not THROWER', p.throwerLabel !== 'THROWER', 'label=' + p.throwerLabel + ' throw=' + p.throwerPct);
}

console.log('\n=== Deterministic jitter ===');
{
  const a = A.analyzeMatch(mk({ kills: 20, deaths: 5, headshots: 120, bodyshots: 180, legshots: 0, score: 300, damageDealt: 2500, damageReceived: 1500, firstBloods: 6, assists: 4 }, AG.jett));
  const b = A.analyzeMatch(mk({ kills: 20, deaths: 5, headshots: 120, bodyshots: 180, legshots: 0, score: 300, damageDealt: 2500, damageReceived: 1500, firstBloods: 6, assists: 4 }, AG.jett));
  check('Same input -> same pct (seeded jitter)', a.players[0].cheaterPct === b.players[0].cheaterPct);
}

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED ✅' : fail + ' CHECK(S) FAILED ❌'}  (${pass} passed, ${fail} failed)\n`);
process.exit(fail === 0 ? 0 : 1);

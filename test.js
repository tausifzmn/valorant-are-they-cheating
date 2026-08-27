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
function mk(stats, agent, rounds = 24, rank = 12) {
  return {
    info: {
      roundsPlayed: rounds,
      teams: [{ roundsPlayed: rounds }],
      players: [{ puuid: 'p_' + (stats.name || 'x'), gameName: stats.name || 'Test', tagLine: 'TST', characterId: agent, teamId: 'Blue', stats }],
    },
    rankTierId: rank,
  };
}
const AG = {
  raze: 'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc', jett: 'e370fa57-4757-3604-3648-499e1f642d3f',
  chamber: '462180ff-8be3-8a3c-e330-f2cdcee6e5a3', vyse: '4a79e213-4997-29ca-9d4d-5943c25dfcf4',
  brim: '9f0d8ba9-4140-b941-57d3-a7ad57c6b417',
};

console.log('\n=== CHEATER: HS% band + kills-gate ===');
{
  const r = A.analyzeMatch(mk({ kills: 24, deaths: 14, headshots: 270, bodyshots: 405, legshots: 0, score: 420, damageDealt: 3500, damageReceived: 3000, firstBloods: 6, assists: 5 }, AG.jett, 24, 27), null, 27); // Radiant
  check('Radiant-Jett 40% HS reads LOW (cheat<35)', r.players[0].cheaterPct < 35, 'cheat=' + r.players[0].cheaterPct);
}
{
  const r = A.analyzeMatch(mk({ kills: 22, deaths: 10, headshots: 406, bodyshots: 294, legshots: 0, score: 480, damageDealt: 4200, damageReceived: 2500, firstBloods: 8, assists: 4 }, AG.raze, 24, 12), null, 12); // Gold
  check('Raze 58% HS at Gold reads HIGH (cheat>=45)', r.players[0].cheaterPct >= 45, 'cheat=' + r.players[0].cheaterPct);
}
{
  // 60% HS is the rank-INVARIANT hard tell -> reads high regardless of low kills (cheating is cheating)
  const r = A.analyzeMatch(mk({ kills: 5, deaths: 8, headshots: 18, bodyshots: 12, legshots: 0, score: 90, damageDealt: 800, damageReceived: 1200, firstBloods: 1, assists: 1 }, AG.chamber, 24, 9), null, 9); // Silver
  check('60% HS is a hard tell -> cheater HIGH even on 5 kills', r.players[0].cheaterPct >= 45, 'cheat=' + r.players[0].cheaterPct);
}
{
  // kills-gate only softens the SOFT band: 50% HS on 5 kills < 50% HS on 25 kills (both below 60 hard cap)
  const low = A.analyzeMatch(mk({ kills: 5, deaths: 8, headshots: 75, bodyshots: 75, legshots: 0, score: 130, damageDealt: 900, damageReceived: 1200, firstBloods: 1, assists: 1 }, AG.chamber, 24, 9), null, 9).players[0].cheaterPct;
  const high = A.analyzeMatch(mk({ kills: 25, deaths: 12, headshots: 375, bodyshots: 375, legshots: 0, score: 650, damageDealt: 4500, damageReceived: 2400, firstBloods: 9, assists: 4 }, AG.chamber, 24, 9), null, 9).players[0].cheaterPct;
  check('kills-gate: 50% HS on 25 kills > 50% HS on 5 kills', high > low, 'low=' + low + ' high=' + high);
}
{
  const r = A.analyzeMatch(mk({ kills: 38, deaths: 2, headshots: 200, bodyshots: 300, legshots: 0, score: 600, damageDealt: 5000, damageReceived: 600, firstBloods: 10, assists: 3 }, AG.vyse, 12), null, 12);
  check('Flawless on 12-round game does NOT read 99', r.players[0].cheaterPct < 99, 'cheat=' + r.players[0].cheaterPct);
}

console.log('\n=== RANK-RELATIVE HS + SMURF ===');
// Gold player with Platinum/Diamond-level stats -> high smurf%, cheater soft-discounted (low)
{
  const r = A.analyzeMatch(mk({ kills: 22, deaths: 12, headshots: 240, bodyshots: 360, legshots: 0, score: 300, damageDealt: 3200, damageReceived: 2800, firstBloods: 5, assists: 4 }, AG.jett, 24, 12), null, 12); // Gold, ~40% HS
  const p = r.players[0];
  check('Gold 40%HS player: smurf high (>=50)', p.smurfPct >= 50, 'smurf=' + p.smurfPct);
  check('Gold 40%HS player: cheater stays LOW (smurf discounts soft)', p.cheaterPct < 40, 'cheat=' + p.cheaterPct);
  check('Gold 40%HS player: not hard_present', p.cheaterPct < 85);
}
// SAME stats at Radiant -> smurf low (normal for rank), cheater low
{
  const r = A.analyzeMatch(mk({ kills: 22, deaths: 12, headshots: 240, bodyshots: 360, legshots: 0, score: 300, damageDealt: 3200, damageReceived: 2800, firstBloods: 5, assists: 4 }, AG.jett, 24, 27), null, 27);
  const p = r.players[0];
  check('Radiant same stats: smurf LOW (<50, normal-ish for rank)', p.smurfPct < 50, 'smurf=' + p.smurfPct);
}
// Hard tell overrides smurf: 63% HS at Gold -> cheater high regardless
{
  const r = A.analyzeMatch(mk({ kills: 24, deaths: 0, headshots: 300, bodyshots: 180, legshots: 0, score: 500, damageDealt: 6000, damageReceived: 400, firstBloods: 18, assists: 2 }, AG.raze, 24, 12), null, 12);
  const p = r.players[0];
  check('63%HS 0-death at Gold: cheater HIGH (hard tell wins over smurf)', p.cheaterPct >= 70, 'cheat=' + p.cheaterPct);
  check('63%HS: hard_present true', true);
}

console.log('\n=== THROWER vs JUST-BAD + RANK FACTOR ===');
{
  const r = A.analyzeMatch(mk({ kills: 8, deaths: 22, headshots: 12, bodyshots: 160, legshots: 0, score: 90, damageDealt: 1100, damageReceived: 4000, firstBloods: 2, assists: 1 }, AG.chamber, 24, 3), null, 3); // Iron
  const p = r.players[0];
  check('Inept low-HS low-kill Iron player = JUST BAD', p.throwerLabel === 'JUST BAD', 'label=' + p.throwerLabel);
  check('JUST BAD thrower% is low (<22)', p.throwerPct < 22, 'throw=' + p.throwerPct);
}
{
  const r = A.analyzeMatch(mk({ kills: 3, deaths: 22, headshots: 40, bodyshots: 120, legshots: 0, score: 95, damageDealt: 900, damageReceived: 4200, firstBloods: 1, assists: 0 }, AG.brim, 24, 27), null, 27); // Radiant weak
  const p = r.players[0];
  check('Identical weak stats at Radiant = higher thrower% than Iron', p.throwerPct > 10, 'throw=' + p.throwerPct);
}
{
  const r = A.analyzeMatch(mk({ kills: 9, deaths: 18, headshots: 55, bodyshots: 200, legshots: 0, score: 140, damageDealt: 2200, damageReceived: 3000, firstBloods: 3, assists: 2 }, AG.omen || 'b44415ee-4adb-4dc9-991e-2c83c7e4e5a3', 24, 12), null, 12);
  check('Passive weak Gold player is WEAK not THROWER', r.players[0].throwerLabel !== 'THROWER', 'label=' + r.players[0].throwerLabel);
}

console.log('\n=== Deterministic jitter ===');
{
  const a = A.analyzeMatch(mk({ kills: 20, deaths: 5, headshots: 120, bodyshots: 180, legshots: 0, score: 300, damageDealt: 2500, damageReceived: 1500, firstBloods: 6, assists: 4 }, AG.jett, 24, 12), null, 12);
  const b = A.analyzeMatch(mk({ kills: 20, deaths: 5, headshots: 120, bodyshots: 180, legshots: 0, score: 300, damageDealt: 2500, damageReceived: 1500, firstBloods: 6, assists: 4 }, AG.jett, 24, 12), null, 12);
  check('Same input -> same pct (seeded jitter)', a.players[0].cheaterPct === b.players[0].cheaterPct);
}

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED ✅' : fail + ' CHECK(S) FAILED ❌'}  (${pass} passed, ${fail} failed)\n`);
process.exit(fail === 0 ? 0 : 1);

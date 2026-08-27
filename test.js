const ATC = require('./analysis.js');
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('./demo-match.json', 'utf8'));

const result = ATC.analyzeMatch(raw, 'ME0000000000000000000000000000000000'.slice(0, 32));

console.log('Rounds played:', result.rounds);
console.log('Players analyzed:', result.players.length);
console.log('---');
for (const p of result.players) {
  console.log(
    `${p.name.padEnd(16)} | ${p.headline.padEnd(14)} | cheat ${String(p.cheaterPct).padStart(2)}% | throw ${String(p.throwerPct).padStart(2)}% | enemy=${p.isEnemy}`
  );
}

// sanity assertions
let ok = true;
function check(cond, msg) { if (!cond) { ok = false; console.error('FAIL:', msg); } }

check(result.players.length === 10, 'should analyze 10 players');
const willy = result.players.find(p => p.name === 'wallhack_willy');
check(willy.cheaterPct >= 85, 'wallhack_willy should be top-tier sus');
const andy = result.players.find(p => p.name === 'afk_andy');
check(andy.throwerPct >= 70, 'afk_andy should be a thrower');
const you = result.players.find(p => p.name === 'You');
check(you.isEnemy === false, '"You" should not be marked enemy');
// normal teammates should not be flagged as throwers
for (const nm of ['AimGod99','sweatlord','IGotThis']) {
  const p = result.players.find(x => x.name === nm);
  check(p.throwerPct < 60, `${nm} should not be flagged a thrower (got ${p.throwerPct}%)`);
  check(p.headline !== 'THROWER DETECTED', `${nm} should not be a THROWER headline`);
}

// cheater % must always clamp to 0..99
for (const p of result.players) {
  check(p.cheaterPct >= 0 && p.cheaterPct <= 99, `${p.name} cheater % in range`);
  check(p.throwerPct >= 0 && p.throwerPct <= 99, `${p.name} thrower % in range`);
  check(typeof p.cheaterVerdict === 'string' && p.cheaterVerdict.length > 0, `${p.name} has verdict`);
}

console.log(ok ? '\nALL CHECKS PASSED ✅' : '\nSOME CHECKS FAILED ❌');
process.exit(ok ? 0 : 1);

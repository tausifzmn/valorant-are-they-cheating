/*
 * Integration test for the HenrikDev normalizer + analysis engine.
 * Uses a mock HenrikDev v4 match payload (no network / no key needed) so we can
 * verify the data-source swap works end-to-end. Run: node test-henrik.js
 */
const henrik = require('./henrik');
const ATC = require('./analysis.js');

// A trimmed HenrikDev v4 match response (real shape, synthetic numbers).
const henrikMatch = {
  status: 200,
  data: {
    metadata: { map: '/Game/Maps/Ascent/Ascent', mode: 'Competitive', game_length: 2400 },
    teams: [
      { team_id: 'Blue', won: true, rounds_played: 24, rounds_won: 13 },
      { team_id: 'Red', won: false, rounds_played: 24, rounds_won: 11 },
    ],
    players: [
      { puuid: 'p1', name: 'You', tag: 'NA1', team_id: 'Blue', character_id: 'Jett',
        stats: { stats: { kills: 22, deaths: 14, assists: 6, score: 312, headshots: 140, bodyshots: 180, legshots: 30, damage: { dealt: 4150, received: 3100 }, first_bloods: 5 } } },
      { puuid: 'p2', name: 'wallhack_willy', tag: 'BR1', team_id: 'Red', character_id: 'Phoenix',
        stats: { stats: { kills: 38, deaths: 2, assists: 1, score: 470, headshots: 320, bodyshots: 95, legshots: 10, damage: { dealt: 5400, received: 900 }, first_bloods: 16 } } },
      { puuid: 'p3', name: 'afk_andy', tag: 'LAN', team_id: 'Red', character_id: 'Sage',
        stats: { stats: { kills: 1, deaths: 22, assists: 0, score: 70, headshots: 5, bodyshots: 40, legshots: 8, damage: { dealt: 300, received: 2600 }, first_bloods: 0 } } },
    ],
  },
};

const normalized = henrik.normalizeMatch(henrikMatch);
const result = ATC.analyzeMatch(normalized, null);

let ok = true;
function check(c, m) { if (!c) { ok = false; console.error('FAIL:', m); } }

check(result.players.length === 3, 'should have 3 players');
const willy = result.players.find(p => p.name === 'wallhack_willy');
check(willy.cheaterPct >= 85, 'wallhack_willy cheater % >= 85 (got ' + willy.cheaterPct + ')');
const andy = result.players.find(p => p.name === 'afk_andy');
check(andy.throwerPct >= 70, 'afk_andy thrower % >= 70 (got ' + andy.throwerPct + ')');
const you = result.players.find(p => p.name === 'You');
check(you.cheaterPct < 60 && you.throwerPct < 60, 'you should be clean-ish');

// history normalizer
const hist = henrik.normalizeHistory({ data: [
  { metadata: { matchid: 'abc', mode: 'Competitive', map: 'Ascent', game_start: 1700000000 } },
  { metadata: { matchid: 'def', mode: 'Competitive', map: 'Bind', game_start: 1700001000 } },
] });
check(hist.matches.length === 2 && hist.matches[0].matchId === 'abc', 'history normalized');
check(hist.matches[0].startedAt === 1700000000000, 'game_start seconds -> ms');

// account normalizer
const acc = henrik.normalizeAccount({ puuid: 'xyz', name: 'tofu', tag: 'ugly' });
check(acc.puuid === 'xyz' && acc.gameName === 'tofu' && acc.tagLine === 'ugly', 'account normalized');

console.log(ok ? 'HENRIK INTEGRATION TESTS PASSED ✅' : 'HENRIK TESTS FAILED ❌');
process.exit(ok ? 0 : 1);

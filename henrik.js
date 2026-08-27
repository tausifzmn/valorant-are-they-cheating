/*
 * henrik.js — normalizes HenrikDev API responses into the internal shape that
 * analysis.js already understands (a Riot-flavored { info: { players, teams } }).
 * This keeps the tested scoring engine unchanged while swapping the data source
 * from Riot's official API to HenrikDev's community API.
 *
 * HenrikDev v4 match shape (relevant fields):
 *   { data: { players: [ { puuid, name, tag, team_id, character_id,
 *                          stats: { kills, deaths, assists, score, headshots,
 *                                   bodyshots, legshots, damage:{dealt,received},
 *                                   first_bloods? } } ],
 *            teams: [ { team_id, won, rounds_won, rounds_played } ],
 *            metadata: { map, mode, queue, game_length } } }
 */

function normalizeMatch(raw) {
  const root = raw && raw.data ? raw.data : (raw || {});
  const players = (root.players || []).map((p) => {
    const s = p.stats || {};
    const dmg = s.damage || {};
    return {
      puuid: p.puuid || '',
      gameName: p.name || 'Unknown',
      tagLine: p.tag || '',
      characterId: p.character_id || p.agent || p.character || '',
      teamId: p.team_id || '',
      premade: false,
      stats: {
        kills: s.kills || 0,
        deaths: s.deaths || 0,
        assists: s.assists || 0,
        score: s.score || 0,
        headshots: s.headshots || 0,
        bodyshots: s.bodyshots || 0,
        legshots: s.legshots || 0,
        damageDealt: dmg.dealt || s.damageDealt || 0,
        damageReceived: dmg.received || s.damageReceived || 0,
        firstBloods: s.first_bloods || s.firstBloods || 0,
      },
    };
  });

  const teams = (root.teams || []).map((t) => ({
    teamId: t.team_id || t.teamId || '',
    roundsPlayed: t.rounds_played || t.roundsPlayed || 0,
    roundsWon: t.rounds_won || t.roundsWon || 0,
  }));

  return { info: { players, teams } };
}

function normalizeHistory(raw) {
  const list = (raw && raw.data) || [];
  return {
    matches: list.slice(0, 20).map((m) => {
      const meta = m.metadata || {};
      return {
        matchId: meta.match_id || meta.matchId || '',
        gameMode: meta.mode || meta.queue || '',
        mapId: meta.map || '',
        startedAt: meta.game_start || meta.gameStart || 0,
      };
    }),
  };
}

function normalizeAccount(raw) {
  // v1 returns { puuid, region, name, tag, account_level, ... }
  return {
    puuid: raw.puuid || '',
    gameName: raw.name || raw.gameName || '',
    tagLine: raw.tag || raw.tagLine || '',
  };
}

module.exports = { normalizeMatch, normalizeHistory, normalizeAccount };

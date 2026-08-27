/*
 * henrik.js — normalizes HenrikDev API responses into the internal shape that
 * analysis.js understands (a Riot-flavored { info: { players, teams } }).
 * Tolerant of both flat and double-nested stats shapes (v4 nests as
 * player.stats.stats.<field>).
 *
 * HenrikDev endpoints used (from the official OpenAPI spec):
 *   GET /valorant/v1/account/{name}/{tag}
 *   GET /valorant/v3/matches/{affinity}/{name}/{tag}
 *   GET /valorant/v4/match/{affinity}/{match_id}
 */

function statObj(p) {
  const s = p.stats || {};
  // v4 nests the real numbers under stats.stats; fall back to flat.
  return (s && s.stats) ? s.stats : s;
}

function normalizeMatch(raw) {
  const root = (raw && raw.data) ? raw.data : (raw || {});
  const players = (root.players || []).map((p) => {
    const s = statObj(p);
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
      // HenrikDev uses `metadata.matchid` (no underscore). game_start is in SECONDS.
      const rawStart = meta.game_start || meta.gameStart || 0;
      return {
        matchId: meta.matchid || meta.match_id || meta.matchId || '',
        gameMode: meta.mode || meta.queue || '',
        mapId: meta.map || '',
        startedAt: rawStart ? Number(rawStart) * 1000 : 0,
      };
    }),
  };
}

function normalizeAccount(raw) {
  const d = (raw && raw.data) ? raw.data : (raw || {});
  return {
    puuid: d.puuid || '',
    gameName: d.name || d.gameName || '',
    tagLine: d.tag || d.tagLine || '',
  };
}

module.exports = { normalizeMatch, normalizeHistory, normalizeAccount };

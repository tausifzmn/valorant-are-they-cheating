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
    // HenrikDev v4 nests the character as an OBJECT {id, name} OR a string id.
    // Pull the UUID string out of whichever shape we get, and keep the display
    // name so we can label the agent even if the UUID isn't in our table.
    const charRaw = p.character_id || p.character || p.agent || p.agent_id || '';
    const characterId = (charRaw && typeof charRaw === 'object')
      ? (charRaw.id || charRaw.uuid || charRaw.characterId || '')
      : (charRaw || '');
    const characterName = (charRaw && typeof charRaw === 'object')
      ? (charRaw.name || charRaw.displayName || '')
      : '';
    return {
      puuid: p.puuid || '',
      gameName: p.name || 'Unknown',
      tagLine: p.tag || '',
      characterId: characterId,
      characterName: characterName,
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

// Extract per-player stat rows from a v4 /by-puuid/matches history response.
// Each history entry already contains the full stat block for that player, so
// we pull the searched player's line (matched by puuid) out of every match.
function extractPlayerHistory(raw, puuid) {
  const list = (raw && raw.data) || [];
  const rows = [];
  for (const m of list) {
    const players = (m && m.players) || [];
    const me = players.find((p) => (p.puuid || '') === puuid)
      || players.find((p) => (p.puuid || '').toLowerCase() === String(puuid).toLowerCase());
    if (!me) continue;
    const s = (me.stats && me.stats.stats) ? me.stats.stats : (me.stats || {});
    const dmg = s.damage || {};
    const hs = s.headshots || 0, bs = s.bodyshots || 0, ls = s.legshots || 0;
    const total = hs + bs + ls;
    const kills = s.kills || 0, deaths = s.deaths || 0, score = s.score || 0;
    const meTeamId = me.team_id || me.teamId || '';
    const meta = m.metadata || {};
    // HenrikDev v4 by-puuid history nests matchId + rounds under .metadata
    // and may use either flat or nested rounds shape.
    const matchId = meta.matchid || meta.match_id || meta.matchId || (m.metadata && (m.metadata.id || m.metadata.match_id)) || '';
    const rounds = (m.teams && m.teams[0] && (m.teams[0].rounds_played || (m.teams[0].rounds && (m.teams[0].rounds.played || 0)))) || 0;
    const roundsWon = (m.teams || []).reduce((a, t) => a + (t.rounds_won || (t.rounds && t.rounds.won) || 0), 0);
    const r = rounds || roundsWon || 24;
    // Win = this player is on the team that has t.won === true
    const wonTeam = (m.teams || []).find((t) => t.won === true);
    const won = wonTeam ? (wonTeam.team_id || wonTeam.teamId) === meTeamId : false;
    rows.push({
      matchId,
      kills, deaths,
      assists: s.assists || 0,
      hsPct: total ? hs / total : 0,
      acs: r ? score / r : 0,
      kd: deaths === 0 ? kills : kills / deaths,
      score: score,
      firstBloods: s.first_bloods || s.firstBloods || 0,
      wins: won ? 1 : 0,
    });
  }
  return rows;
}

function normalizeAccount(raw) {
  const d = (raw && raw.data) ? raw.data : (raw || {});
  return {
    puuid: d.puuid || '',
    gameName: d.name || d.gameName || '',
    tagLine: d.tag || d.tagLine || '',
  };
}

module.exports = { normalizeMatch, normalizeHistory, normalizeAccount, extractPlayerHistory };

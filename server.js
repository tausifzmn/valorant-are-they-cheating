/*
 * server.js — single Express app serving the static site and proxying the
 * HenrikDev Valorant API (https://api.henrikdev.xyz). HenrikDev wraps Riot's
 * data, is CORS-friendly, and only needs a free key (Basic tier granted
 * instantly). The key stays server-side — browsers can't call the API directly
 * (and we don't want to expose the key). Runs locally AND on Vercel unchanged.
 */
require('dotenv').config();
const path = require('path');
const compression = require('compression');
const express = require('express');
const app = express();
app.use(compression());
const PORT = process.env.PORT || 3000;
const henrik = require('./henrik');
const A = require('./analysis');

const API_KEY = process.env.HENRIK_API_KEY || process.env.RIOT_API_KEY || '';

async function henrikFetch(pathname) {
  if (!API_KEY) throw new Error('NO_KEY');
  const res = await fetch(`https://api.henrikdev.xyz${pathname}`, {
    headers: { Authorization: API_KEY, Accept: 'application/json' },
  });
  if (res.status === 401) throw new Error('KEY_MISSING');
  if (res.status === 403) throw new Error('KEY_INVALID');
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error('HENRIK_' + res.status);
  const json = await res.json();
  if (json && json.status === 429) throw new Error('RATE_LIMITED');
  return json;
}

// Cache for rank (mmr) — rank doesn't change often, so cache aggressively
const tierCache = new Map(); // key -> { ts, tierId, tierName }
const TIER_TTL = 60 * 60 * 1000; // 1 hour

async function fetchTier(name, tag, affinity) {
  const key = `${affinity}:${name}:${tag}`.toLowerCase();
  const c = tierCache.get(key);
  if (c && Date.now() - c.ts < TIER_TTL) return c;
  try {
    const enc = encodeURIComponent;
    const data = await henrikFetch(`/valorant/v3/mmr/${affinity}/pc/${enc(name)}/${enc(tag)}`);
    const tier = (data && data.data && data.data.current && data.data.current.tier) || null;
    const out = { ts: Date.now(), tierId: tier && tier.id != null ? tier.id : 0, tierName: (tier && tier.name) || 'Unranked' };
    tierCache.set(key, out);
    return out;
  } catch (_) { return { ts: Date.now(), tierId: 0, tierName: 'Unranked' }; }
}

// GET /api/account/:name/:tag  -> { puuid, gameName, tagLine, tierId, tierName }
// Account resolves fast (~500ms). Rank (v3 mmr) is slow (~2.4s) on HenrikDev.
// We race them: respond as soon as account is done OR mmr is done, whichever first.
// If mmr times out at 800ms we ship with tierId=0 and the UI can re-fetch /api/rank.
app.get('/api/account/:name/:tag', async (req, res) => {
  try {
    const { name, tag } = req.params;
    const affinity = (req.query.region || 'na').toLowerCase();
    const enc = encodeURIComponent;
    const acct = await henrikFetch(`/valorant/v1/account/${enc(name)}/${enc(tag)}`);
    const norm = henrik.normalizeAccount(acct);
    // Race mmr against 800ms budget; fall back to tierCache (no extra upstream call on warm)
    const mmrRace = fetchTier(name, tag, affinity).then((t) => ({ tierId: t.tierId, tierName: t.tierName }));
    let mmrTimer;
    const mmrTimeout = new Promise((resolve) => { mmrTimer = setTimeout(() => resolve(null), 800); });
    const tier = await Promise.race([mmrRace, mmrTimeout]);
    clearTimeout(mmrTimer);
    if (tier) { norm.tierId = tier.tierId; norm.tierName = tier.tierName; }
    res.set('Cache-Control', 'private, max-age=60');
    res.json(norm);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /api/rank/:name/:tag  -> { tierId, tierName }  (standalone)
app.get('/api/rank/:name/:tag', async (req, res) => {
  try {
    const { name, tag } = req.params;
    const affinity = (req.query.region || 'na').toLowerCase();
    const t = await fetchTier(name, tag, affinity);
    res.set('Cache-Control', 'private, max-age=300'); // rank is slow to change
    res.json({ tierId: t.tierId, tierName: t.tierName });
  } catch (e) { res.status(502).json({ error: e.message }); }
});


// GET /api/matches/:name/:tag  -> { matches:[{matchId,gameMode,mapId,startedAt}] }
app.get('/api/matches/:name/:tag', async (req, res) => {
  try {
    const { name, tag } = req.params;
    const affinity = (req.query.region || 'na').toLowerCase();
    const enc = encodeURIComponent;
    // size=10 (we only render ~10 recent matches in the UI; smaller = faster upstream)
    const data = await henrikFetch(`/valorant/v3/matches/${affinity}/${enc(name)}/${enc(tag)}?size=10`);
    res.set('Cache-Control', 'private, max-age=30');
    res.json(henrik.normalizeHistory(data));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Server-side cache for full match details — opened matches re-render instantly
const matchCache = new Map(); // matchId -> { ts, data }
const MATCH_TTL = 30 * 60 * 1000; // 30 min

// GET /api/match/:region/:id  -> normalized { info:{players,teams} } for the engine
app.get('/api/match/:region/:id', async (req, res) => {
  try {
    const { region, id } = req.params;
    const cached = matchCache.get(id);
    if (cached && Date.now() - cached.ts < MATCH_TTL) {
      const m = cached.data;
      m.rankTierId = parseInt(req.query.rank, 10) || m.rankTierId || null;
      res.set('X-Cache', 'HIT');
      res.set('Cache-Control', 'private, max-age=60');
      return res.json(m);
    }
    const data = await henrikFetch(`/valorant/v4/match/${region}/${id}`);
    const match = henrik.normalizeMatch(data);
    const tierId = parseInt(req.query.rank, 10);
    match.rankTierId = Number.isFinite(tierId) ? tierId : null;
    matchCache.set(id, { ts: Date.now(), data: match });
    res.set('X-Cache', 'MISS');
    res.set('Cache-Control', 'private, max-age=60');
    res.json(match);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /api/history/:region/:puuid  -> { rows:[...], cached:bool }  (last 10 competitive games, this player's stats)
const historyCache = new Map(); // puuid -> { ts, rows }
const HISTORY_TTL = 20 * 60 * 1000; // 20 min
app.get('/api/history/:region/:puuid', async (req, res) => {
  try {
    const { region, puuid } = req.params;
    const cached = historyCache.get(puuid);
    if (cached && Date.now() - cached.ts < HISTORY_TTL) {
      return res.json({ rows: cached.rows, cached: true });
    }
    const data = await henrikFetch(`/valorant/v4/by-puuid/matches/${region}/pc/${puuid}?size=10&mode=competitive`);
    const rows = henrik.extractPlayerHistory(data, puuid);
    historyCache.set(puuid, { ts: Date.now(), rows });
    res.json({ rows, cached: false });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /api/trend/:region/:id  -> analyzeMatch result WITH career-trend context for all 10 players.
// Uses matchCache for the match payload and historyCache per puuid so repeat clicks
// cost ~0. Excludes the current match from history rows.
app.get('/api/trend/:region/:id', async (req, res) => {
  try {
    const { region, id } = req.params;
    const tierId = parseInt(req.query.rank, 10);
    // Match: cache hit or one upstream call
    let match;
    const mc = matchCache.get(id);
    if (mc && Date.now() - mc.ts < MATCH_TTL) {
      match = JSON.parse(JSON.stringify(mc.data)); // deep clone so we don't mutate cache
      match.rankTierId = Number.isFinite(tierId) ? tierId : match.rankTierId || null;
    } else {
      const data = await henrikFetch(`/valorant/v4/match/${region}/${id}`);
      match = henrik.normalizeMatch(data);
      match.rankTierId = Number.isFinite(tierId) ? tierId : null;
      matchCache.set(id, { ts: Date.now(), data: match });
    }

    // Per-puuid histories: parallel fetch only for players NOT already cached
    const trends = {};
    const puuids = (match.info.players || []).map((p) => p.puuid).filter(Boolean);
    const toFetch = [];
    const enc = encodeURIComponent;
    for (const puuid of puuids) {
      const c = historyCache.get(puuid);
      if (c && Date.now() - c.ts < HISTORY_TTL) {
        const filtered = c.rows.filter((r) => r.matchId !== id);
        const tr = A.accumulateTrend(filtered);
        if (tr) trends[puuid] = tr;
      } else {
        toFetch.push(puuid);
      }
    }
    // Parallelize the cold fetches; each ~300-400ms so 10 cold = ~400ms total
    await Promise.all(toFetch.map(async (puuid) => {
      try {
        const data = await henrikFetch(`/valorant/v4/by-puuid/matches/${region}/pc/${enc(puuid)}?size=10&mode=competitive`);
        const rows = henrik.extractPlayerHistory(data, puuid);
        historyCache.set(puuid, { ts: Date.now(), rows });
        const filtered = rows.filter((r) => r.matchId !== id);
        const tr = A.accumulateTrend(filtered);
        if (tr) trends[puuid] = tr;
      } catch (_) { /* skip players we can't fetch; degrade gracefully */ }
    }));

    const result = A.analyzeMatch(match, null, match.rankTierId, trends);
    result.trendCoverage = Object.keys(trends).length + '/' + puuids.length;
    res.set('Cache-Control', 'private, max-age=30');
    res.json(result);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  console.log(`Are They Cheating? running on http://localhost:${PORT}`);
  app.listen(PORT);
}
module.exports = app;

/*
 * server.js — single Express app serving the static site and proxying the
 * HenrikDev Valorant API (https://api.henrikdev.xyz). HenrikDev wraps Riot's
 * data, is CORS-friendly, and only needs a free key (Basic tier granted
 * instantly). The key stays server-side — browsers can't call the API directly
 * (and we don't want to expose the key). Runs locally AND on Vercel unchanged.
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const henrik = require('./henrik');

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

// GET /api/account/:name/:tag  -> { puuid, gameName, tagLine, tierId, tierName }
app.get('/api/account/:name/:tag', async (req, res) => {
  try {
    const { name, tag } = req.params;
    const affinity = (req.query.region || 'na').toLowerCase();
    const data = await henrikFetch(`/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
    const acct = henrik.normalizeAccount(data);
    // fetch current competitive rank (v3 mmr) to enable rank-relative scoring
    try {
      const mmr = await henrikFetch(`/valorant/v3/mmr/${affinity}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
      const tier = (mmr && mmr.data && mmr.data.current && mmr.data.current.tier) || null;
      if (tier) { acct.tierId = tier.id != null ? tier.id : 0; acct.tierName = tier.name || 'Unknown'; }
    } catch (_) { /* rank is optional; scoring degrades gracefully */ }
    res.json(acct);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /api/rank/:name/:tag  -> { tierId, tierName }  (standalone)
app.get('/api/rank/:name/:tag', async (req, res) => {
  try {
    const { name, tag } = req.params;
    const affinity = (req.query.region || 'na').toLowerCase();
    const mmr = await henrikFetch(`/valorant/v3/mmr/${affinity}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
    const tier = (mmr && mmr.data && mmr.data.current && mmr.data.current.tier) || null;
    res.json(tier ? { tierId: tier.id != null ? tier.id : 0, tierName: tier.name || 'Unknown' } : { tierId: 0, tierName: 'Unranked' });
  } catch (e) { res.status(502).json({ error: e.message }); }
});


// GET /api/matches/:name/:tag  -> { matches:[{matchId,gameMode,mapId,startedAt}] }
app.get('/api/matches/:name/:tag', async (req, res) => {
  try {
    const { name, tag } = req.params;
    const affinity = (req.query.region || 'na').toLowerCase();
    const data = await henrikFetch(`/valorant/v3/matches/${affinity}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=20`);
    res.json(henrik.normalizeHistory(data));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /api/match/:region/:id  -> normalized { info:{players,teams} } for the engine
app.get('/api/match/:region/:id', async (req, res) => {
  try {
    const { region, id } = req.params;
    const data = await henrikFetch(`/valorant/v4/match/${region}/${id}`);
    const match = henrik.normalizeMatch(data);
    // rank tier (searched player's competitive tier) enables rank-relative scoring
    const tierId = parseInt(req.query.rank, 10);
    match.rankTierId = Number.isFinite(tierId) ? tierId : null;
    res.json(match);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  console.log(`Are They Cheating? running on http://localhost:${PORT}`);
  app.listen(PORT);
}
module.exports = app;

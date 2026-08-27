/*
 * server.js — single Express app that serves the static site AND proxies the
 * Riot VALORANT API. This file runs unchanged both locally (`npm start`) and on
 * Vercel (vercel.json rewrites to it). The Riot API key lives ONLY here, so it
 * never reaches the browser. Browsers can't call Riot directly (no CORS + key
 * secrecy), hence this proxy.
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const RIOT_KEY = process.env.RIOT_API_KEY || '';

// Region routing: Riot account + match history use the "routing" region;
// match details use the "cluster" shard. We keep it simple and let the client
// pass a region; default to na (North America).
const ROUTING = {
  na: 'americas', eu: 'europe', ap: 'asia', kr: 'asia', latam: 'americas', br: 'americas',
};
const SHARD = {
  na: 'na', eu: 'eu', ap: 'ap', kr: 'kr', latam: 'latam', br: 'br',
};

async function riotFetch(url) {
  if (!RIOT_KEY) throw new Error('NO_KEY');
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_KEY } });
  if (res.status === 403) throw new Error('KEY_INVALID');
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error('RIOT_' + res.status);
  return res.json();
}

app.get('/api/account/:name/:tag', async (req, res) => {
  try {
    const { name, tag } = req.params;
    const region = ROUTING[(req.query.region || 'na').toLowerCase()] || 'americas';
    const data = await riotFetch(
      `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`
    );
    res.json({ puuid: data.puuid, gameName: data.gameName, tagLine: data.tagLine });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/matches/:puuid', async (req, res) => {
  try {
    const region = ROUTING[(req.query.region || 'na').toLowerCase()] || 'americas';
    const data = await riotFetch(
      `https://${region}.api.riotgames.com/val/match/v1/matchlists/by-puuid/${req.params.puuid}`
    );
    const history = (data.history || []).map((h) => ({
      matchId: h.matchId,
      gameMode: h.queueId,
      mapId: h.mapId,
      startedAt: h.gameStartTimeMillis,
    }));
    res.json({ matches: history });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/match/:matchId', async (req, res) => {
  try {
    const region = ROUTING[(req.query.region || 'na').toLowerCase()] || 'americas';
    const shard = SHARD[(req.query.region || 'na').toLowerCase()] || 'na';
    const data = await riotFetch(
      `https://${region}.api.riotgames.com/val/match/v1/matches/${req.params.matchId}`
    );
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Demo match (no key required) — clearly labeled "SAMPLE DATA" in the UI.
app.get('/api/demo', (req, res) => {
  res.json(require('./demo-match.json'));
});

// Static site
app.use(express.static(path.join(__dirname, 'public')));

// Vercel: export the handler; local: start listening.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Are They Cheating? running on http://localhost:${PORT}`));
}
module.exports = app;

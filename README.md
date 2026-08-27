# Are They Cheating? 🕵️ — Valorant Vibe Check

A goofy web app: search any Valorant player by Riot ID, browse their **match history**,
click a match, and get a comedic **cheater % / thrower %** vibe-check for every player in that game.
Built on the community **HenrikDev Valorant API** (which wraps Riot's data).

> ⚠️ **For entertainment only.** This app cannot and does not detect real cheating.
> It runs a joke heuristic on publicly visible match stats. Do not accuse real people
> of cheating based on it. It's vibes, not a report.

## Data source
- Uses **[HenrikDev API](https://api.henrikdev.xyz)** (`api.henrikdev.xyz`) — a free, CORS-friendly
  community wrapper around Riot's VALORANT data. A key is required (since v4), but a **Basic key is
  granted instantly** and there's no 24h rotation like Riot's official Dev key.
- We tried scraping tracker.gg instead — abandoned it: the page is JS-rendered, ToS-violating, and
  the data is encrypted. HenrikDev is the sane path.

## Architecture
- **Frontend:** `public/index.html` (no build step).
- **Backend:** `server.js` — a single Express app that serves the site AND proxies HenrikDev so the
  key stays server-side (browsers can't call the API directly, and we don't leak the key). Runs locally
  and on Vercel unchanged.
- **Normalizer:** `henrik.js` — maps HenrikDev's v4 response shape into the `{ info: { players, teams } }`
  shape the engine expects.
- **Engine:** `analysis.js` — pure, dependency-free, unit-tested scoring (browser + Node).

## Flow
`search "name#TAG" + region` → account lookup → match history → click a match → verdicts for all 10 players.

## API endpoints (backend proxy)
- `GET /api/account/:name/:tag` → `{ puuid, gameName, tagLine }`
- `GET /api/matches/:name/:tag?region=na` → recent match summaries
- `GET /api/match/:region/:id` → normalized match → engine
- `GET /api/demo` → bundled sample match (works with no key — clearly labeled in the UI)

## Run locally
```bash
npm install
echo "HENRIK_API_KEY=your_key_here" > .env   # free key: https://api.henrikdev.xyz/dashboard/
npm start                                    # http://localhost:3000
```
- **Basic key** (30 req/min, instant): fine for local use / a few friends.
- **Enhanced key** (90 req/min, free but apply ~1-2wk): use this before a **public** deployment.

## Deploy to Vercel (public URL)
```bash
npm install -g vercel
vercel                                       # set HENRIK_API_KEY in dashboard (Project → Settings → Env Vars)
vercel --prod
```
Get an **Enhanced** key before going public. `vercel.json` rewrites all traffic to `api/index.js`.

## Tests
```bash
node test.js          # scoring engine on demo data
node test-henrik.js   # HenrikDev normalizer -> engine (mock payload, no key)
```

## License
MIT — goof responsibly.

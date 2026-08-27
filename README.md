# Are They Cheating? — Valorant Vibe Check

A goofy web app: search any Valorant player by Riot ID, browse their **match history**,
click a match, and get a comedic **cheater % / thrower %** vibe-check for every player in that game.
Built on Riot's official VAL-MATCH-V1 API.

> ⚠️ **For entertainment only.** This app cannot and does not detect real cheating.
> It runs a joke heuristic on publicly visible match stats. Do not accuse real people
> of cheating based on it. It's vibes, not a report.

## Architecture
- **Frontend:** static `public/index.html` (no build step).
- **Backend:** `server.js` — a single Express app that (a) serves the static site and
  (b) proxies Riot's API so your key stays server-side (browsers can't call Riot directly
  due to CORS + key secrecy). The same file runs locally **and** on Vercel.
- **Analysis engine:** `analysis.js` — pure, dependency-free, runs in browser + Node, unit-tested.

## API endpoints (backend proxy)
- `GET /api/account/:name/:tag` → Riot account → `{ puuid, gameName, tagLine }`
- `GET /api/matches/:puuid` → recent match list (mini summaries)
- `GET /api/match/:matchId` → full match details (passed to the engine)
- `GET /api/demo` → bundled sample match (works with no key — clearly labeled in the UI)

## Run locally
```bash
npm install
echo "RIOT_API_KEY=your_personal_key_here" > .env
npm start
# open http://localhost:3000
```
Get a free key: https://developer.riotgames.com (Personal key, ~100 req/2min, rotates ~24h).

## Deploy to Vercel
```bash
npm install -g vercel
vercel            # then set RIOT_API_KEY in the Vercel dashboard (Project → Settings → Environment Variables)
vercel --prod
```
`vercel.json` rewrites all traffic to `server.js` (the `api` directory is not required).

## Tests
```bash
node test.js
```

## License
MIT — goof responsibly.

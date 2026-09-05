# VERY GOOD FILMS

A separate film-scene publisher for **@verygood.films**, adapted from RapWire's architecture. Video-first Reels and Threads posts, eight caption modes, verified film metadata, FFmpeg formatting, duplicate-scene memory, and durable publishing recovery.

## Run

Node 24+, FFmpeg/ffprobe and GitHub CLI are required locally. The workflow installs its runtime automatically.

```bash
npm ci
npm test
npm run doctor
npm run discover
npm run media:prepare
npm run status
npm run publish
```

Publishing starts paused. Configure the four account secrets, verify `npm run doctor` reports the intended usernames, supply verified scenes, and then set `config/brand.json` → `enabled: true`. GitHub Actions checks every five minutes. The launch cadence is 8/day, spaced three hours apart, with a three-day same-film cooldown. The same scene is never intentionally recycled. After the first stable week, change the cap to 24 and the minimum gap to 60 minutes for hourly posting.

Required repository secrets: `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN`, `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN`. The public repository serves MP4s from its `media` release. The workflow's own GitHub token uploads prepared assets. Locally set `GITHUB_REPOSITORY=Fulstak-apps/very-good-films-publisher` and authenticate `gh`.

Optional: `TMDB_READ_TOKEN` (film discovery), `OMDB_API_KEY` (verified IMDb ratings), `VGF_UPLOAD_TOKEN` plus repository variable `VGF_MEDIA_ORIGIN` (Cloudflare storage).

See [Architecture](docs/ARCHITECTURE.md), [Scene feed contract](docs/SCENE_FEED.md), [Operations](docs/OPERATIONS.md), and [editorial prompt](prompts/editor.md).

The catalog and configured scene feeds are the source of publishable clips. A title discovered from metadata alone cannot produce an authentic film scene. Browser login, API authorization, and scene supply are separate setup steps.

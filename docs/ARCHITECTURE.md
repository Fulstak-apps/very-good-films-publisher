# Very Good Films architecture

Derived from Fulstak-apps/rapwire-instagram-publisher, inspected at main commit `52bd6c3781040957c4e0ed6c1f749dd12a43ee3a` on 2026-09-05. `src/container-state.mjs` reuses RapWire's resumable container engine; the editorial policy, media path, discovery and memory are separate. RapWire's files, secrets, queue, account and schedules are untouched.

1. **Discovery:** local scene catalog and configured JSON feeds. Optional TMDB daily suggestions identify films needing a scene source; they do not masquerade as publishable assets.
2. **Metadata:** sourced film identity, credits, synopsis and scene evidence. Optional OMDb enrichment verifies title/year/IMDb ID before attaching an IMDb rating.
3. **Clip engine:** downloads an allowlisted source, takes a verified start/end interval, preserves the complete frame by default or applies an explicit center crop.
4. **Caption writer:** eight evidence-based styles with Instagram and Threads lengths. Unsupported trivia is omitted.
5. **Formatter:** FFmpeg, H.264, yuv420p, AAC stereo, 30 fps, 1080×1920, faststart. ffprobe validates video, audio and duration.
6. **Memory/QA:** versioned film and scene database in `state/memory.json`, overlap and asset-hash duplicate detection, verified identity gates and movie cooldown.
7. **Media hosting:** public GitHub release assets, matching RapWire's public-media approach without adding a Cloudflare login requirement. Optional separate Cloudflare R2/Worker with authenticated uploads and ranged public MP4 delivery.
8. **Publishers:** official Meta APIs, verify both destination usernames, check Instagram capacity, create container, poll, persist publish intent, publish, record per-platform IDs.
9. **Scheduler:** GitHub Actions checks every five minutes; one active scene at a time, 20 posts per rolling day and at least 60 minutes between Instagram posts. Workflow timing is approximate. Raising the cap to 40 also requires lowering the gap; platform quota remains authoritative.
10. **Recovery:** a timed-out publish cannot create a new post automatically. Inspect and reconcile its saved container/media identity first. A saved state must reach the remote main branch before a non-idempotent publish request.

Secrets live in GitHub Actions secrets or an untracked local environment. No browser session cookies are used by the automated publisher. Authorizing a browser session does not itself supply API publishing credentials.

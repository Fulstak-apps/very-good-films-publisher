# Scene input contract

Place JSON in `catalog/` or configure HTTPS JSON-array feeds in `config/sources.json`. Add each exact media hostname to `allowed_media_hosts`. Feed input is treated as data; platform IDs, posting status and other publication state are discarded.

```json
{
  "film": {
    "id": "imdb:tt0063350", "imdb_id": "tt0063350",
    "title": "Night of the Living Dead", "year": 1968, "type": "movie",
    "director": ["George A. Romero"], "cast": ["Duane Jones", "Judith O'Dea"],
    "genres": ["Horror"],
    "synopsis": {"text": "Survivors shelter in a farmhouse as the dead return.", "source_url": "https://www.loc.gov/item/91783945/"},
    "metadata_sources": ["https://www.loc.gov/item/91783945/"]
  },
  "scene": {
    "id": "stable-source-scene-name", "start": 120, "end": 165,
    "context": {"text": "Describe only what the verified clip shows.", "source_url": "https://archive.org/details/NightOfTheLivingDead-MPEG"},
    "crop": "preserve"
  },
  "source_url": "https://your-trusted-host.example/source.mp4",
  "rights": {"status": "public_domain", "evidence_url": "https://blogs.loc.gov/copyright/2020/10/copyright-horror-stories/"},
  "qa": {"identity_verified": true, "scene_verified": true},
  "category": "horror", "priority": 0
}
```

The scene above is a schema example, not a verified timecode. Do not ingest it unchanged.

Optional scene evidence objects: `trivia`, `why_watch`, `performance`, `direction`, `quote`. Each requires `text` and `source_url`; missing evidence falls back to Film Info. Optional `film.imdb_rating` requires `imdb_id`, `imdb_rating_source`, and ISO `rating_checked_at`. TMDB scores are never labeled IMDb.

Use the same film ID and source-relative timecode basis for every copy of a film. Scene IDs block exact repeats; overlapping intervals block alternate cuts, and SHA-256 blocks byte-identical assets. Different scene intervals from the same film are allowed after the configured film cooldown. Different encodes/editions with shifted timestamps still require identity review; this is not perceptual fingerprinting.

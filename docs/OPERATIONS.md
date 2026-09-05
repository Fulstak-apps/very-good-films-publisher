# Operations

## Activate

1. Complete the **Very Good Films Publisher** Meta app with Instagram and Threads use cases. Request only the account/profile and content-publishing permissions necessary for each platform. Connect the intended professional Instagram and Threads accounts.
2. Store the four account IDs/tokens as repository secrets. Do not commit them or put them into issue text. Verify both account usernames match `config/brand.json` with `npm run doctor`.
3. Populate the verified scene catalog or a trusted feed. Validate actual clip identity/timecodes. Metadata discovery is not a video supplier.
4. Run `npm run media:prepare` with the media environment configured. Inspect the formatted asset and captions. The automated workflow processes one unprepared scene per cycle.
5. Set brand `enabled` to true and push. Observe the first successful Instagram **and** Threads IDs in the memory file. A browser manual upload does not validate the API connection.

## State and failures

`state/memory.json` is the authoritative persistent film/scene/publication database, committed before every publish call. Do not overwrite it with an older revision. GitHub workflow concurrency serializes runs. Local runs use an exclusive file lock; do not run a local publisher at the same time as Actions.

If a publish request times out, `*_publish_requested_at` remains and the next check sets `*_reconcile_required`. Check that account's recent posts and saved container in Meta. If published, record the correct `*_media_id` and `*_published_at`. Only clear intent when the platform proves it did not publish. Never blindly set a partly published item back to ready. A completed Instagram post remains recorded if Threads fails.

Rate limiting defers the affected platform for an hour; container ERROR/EXPIRED retries use bounded backoff. Review persistent errors via workflow output and the item's `*_error`. GitHub artifacts preserve recovery state after job failures. Disabled workflows or exhausted GitHub minutes stop checks; inspect Actions periodically.

Rotate/refresh long-lived API tokens before expiration using Meta's documented flow. This repository does not automatically mint account permissions or refresh tokens without configured credentials. If revoked/expired, doctor and account verification fail before publication.

## Optional Cloudflare media

`npx wrangler login`, `npx wrangler r2 bucket create very-good-films-media`, `npx wrangler secret put UPLOAD_TOKEN`, `npx wrangler deploy`. Set the resulting HTTPS origin and matching upload token in the repository. Worker uploads are private; only formatted media objects are served publicly. No RapWire bindings are reused.

## Current API references

- [Meta Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Meta Threads API collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)
- [Cloudflare R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

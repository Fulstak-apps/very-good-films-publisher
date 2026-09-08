# Reliability operations

The publisher is designed so the cloud workflow can publish from durable state while the authenticated Instagram source collector runs continuously on a machine with the saved browser profile.

## Health checks

Every GitHub Actions run writes `health-report.json` and uploads it as an artifact. A run is marked unhealthy only when publishing is enabled, the queue is empty, and no Instagram post has landed for more than one hour. Permanent Meta rejections and overlong captions are moved to `needs_review` so one bad item cannot block the queue.

## Source collector

Keep the collector installed with `npm run source:install` on an always-on Mac or Linux host where the Instagram profile is logged in. It runs every five minutes and commits discovered source posts and the lock ledger to `main`. The GitHub workflow treats an empty cloud feed list as `awaiting_local_source_collector`, which is an expected state while the collector supplies the queue.

## Media hosting

The publisher uses GitHub release assets when no object-storage credentials are configured. For a larger queue, set `VGF_MEDIA_ORIGIN` and `VGF_UPLOAD_TOKEN` in the repository Actions secrets to use the existing object-storage upload path. The health report identifies the active backend; no secret values are written to logs.

## Rotation and review

Editorial selection limits a source to two of the six most recent posts when alternatives are available. Items rejected by Meta for content or caption reasons remain visible in the queue as `needs_review`, while transient and rate-limit errors retain retry behavior.

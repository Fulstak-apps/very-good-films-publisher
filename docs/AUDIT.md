# Publishing audit — September 5, 2026

Implemented:
- Failed preparation backs off per clip instead of blocking every later candidate.
- Local backup only requests refill below the queue target and respects preparation retry time.
- Workflow processing waits end when no publication is in flight.
- Formatter installation is skipped when ffmpeg is already available.
- Local Ollama recovery script is versioned; local logs are ignored.
- Legacy automatically spaced excerpts enter needs_review instead of being described as individually verified. Published and in-flight items are preserved.

Outstanding limitations:
- Instagram source handles are configuration only. There is no automatic source capture implementation.
- The available film catalog is finite; the scheduler cannot provide indefinite content supply.
- Previously prepared videos do not acquire the logo retroactively.
- GitHub scheduled dispatch may be delayed. The local fallback requires an awake, logged-in Mac and functioning GitHub credentials.
- The local model summarizes status; fixed code authorizes dispatch. It does not repair arbitrary faults or send notifications.
- Account verification currently couples both platforms: one invalid credential blocks that invocation.
- Uncertain publication remains deliberately held for reconciliation to prevent duplicate posting.
- Download cache survives only within one run; full-film downloads across runs remain a preparation cost.

Validation: 16 local tests passed, including preserving posted and in-flight records during review migration. Local tests do not prove live publication or editorial quality.

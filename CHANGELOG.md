# Changelog

## 0.1.0 (unreleased)

First release.

- **Dedup**: prefix-deterministic, LZ77-style back-references for tool output the model has already seen. Zero prompt-cache cost.
- **Decay**: ski-rental eviction of stale tool output and written-file bodies, free when the cache has expired, with persisted sticky state.
- **Proxy** for the Anthropic Messages API and the OpenAI Chat Completions API, with streaming, gzip/brotli passthrough and provider usage capture.
- `deja claude`, `deja run [--openai]`, `deja start`: run agents through deja.
- `deja audit`: replay local Claude Code history under four strategies with exact-prefix cache billing.
- `deja preview`: show exactly what deja would have sent at any request of a past session.
- `deja stats`: estimated savings, plus provider-measured cache reads and writes.
- `deja doctor`: setup checks.

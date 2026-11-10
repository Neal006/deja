# Changelog

## 0.1.0 (2026-11-10)

First release.

### Engines
- **Dedup**: prefix-deterministic, LZ77-style back-references for tool output the model has already seen. Zero prompt-cache cost.
- **Decay**: ski-rental eviction of stale tool output and written-file bodies. Free when the cache has expired, eager for cacheless providers (`--uncached`), with persisted sticky state.
  - Ages items from their file's last edit, so content being edited stays in context.
  - Never stubs user answers, subagent reports or skill instructions; `--skip-tools` adds more.
  - Stubs keep an outline of file reads and the salient lines (errors, failures, summaries) of command output.

### Agents and APIs
- Proxy for the Anthropic Messages API, OpenAI Chat Completions and the OpenAI Responses API (Codex), with streaming, gzip/brotli passthrough, keep-alive upstream connections and provider usage capture.
- `deja claude`, `deja run [--openai]`, `deja start`: run agents through deja, on Linux, macOS and Windows.
- `dejaFetch()`: in-process deja for agents built on the Anthropic or OpenAI SDKs.
- `x-deja: off` request header to bypass deja for one request, and a local `GET /deja/health` endpoint.

### Measurement
- `deja audit`: replay local Claude Code history (main sessions and subagents) under four strategies with exact-prefix cache billing, in parallel worker threads. Reports compaction headroom, how often stubbed targets were called again, per-project tables (`--by-project`), a share card (`--share`), cacheless billing (`--uncached`) and a personal staleness sweep with a recommendation (`--tune`).
- `deja audit --agent codex`: the same replay for Codex CLI rollouts, billed with OpenAI-style caching.
- Self-calibration: once deja has seen enough real traffic, `deja audit` scales its dollar figures by the measured ratio between the provider's token counts and deja's estimates (`--no-calibrate` to turn off).
- `deja preview`: show exactly what deja would have sent at any request of a past session.
- `deja stats`: estimated savings, a 14-day sparkline, provider-measured cache reads and writes, estimator accuracy, stub re-run rate, per-model breakdown (`--by-model`), `--reset`.

### Tooling
- `deja doctor` (including a check for base-URL overrides in Claude Code settings), `deja setup statusline`, `deja statusline`, `deja completion bash|zsh|fish`, `deja start --log`.
- Friendly errors for a missing agent or a busy port, a start-up line for wrapped agents, and a savings summary when the proxy stops.
- Test suite with fuzzing of lossless dedup, prefix determinism and incremental equivalence, plus an end-to-end check of the ski-rental competitive ratio.

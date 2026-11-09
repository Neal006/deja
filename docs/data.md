# What deja stores

Everything lives under `~/.deja` (or `$DEJA_HOME`). **No conversation content is ever written to disk:** no prompts, no tool output, no file contents. Only counts, ids and timestamps are kept.

## `ledger.jsonl`

One JSON object per proxied request, appended as each response finishes.

| field | meaning |
|---|---|
| `t` | time (epoch ms) |
| `model` | model named in the request |
| `toolResults` | tool results in the request |
| `compressed` | of those, how many dedup rewrote |
| `tokensBefore` / `tokensAfter` | estimated tool-output tokens before and after deja |
| `freshSaved` | tokens saved in the newest message (billed at full price) |
| `usd` | estimated dollars saved, cache-aware |
| `in` / `cr` / `cw` / `out` | provider-reported uncached input, cache read, cache write and output tokens |
| `est` | deja's estimate of the whole prompt, for calibration |
| `st` | stubs newly applied on this request |
| `rr` | calls in this turn that re-targeted stubbed content |

`deja stats` reads this file, and `deja stats --reset` moves it aside.

## `decay-state.json`

Per conversation (keyed by its first tool-use id): the tool-use ids that have been stubbed, the rent paid since the last eviction, and when the conversation was last seen. That's what keeps evictions sticky across proxy restarts. At most 500 conversations are kept.

## `live/<port>.json`

The running totals of a live proxy, used by `deja statusline` and `GET /deja/health`. It's removed when the proxy stops.

## What `deja audit` reads

`deja audit` and `deja preview` read Claude Code's transcripts in `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`) **read-only**, entirely on your machine. Their output contains aggregates, plus (in the "context hogs" list) the labels of your own tool calls, such as file names and commands. `deja audit --share` prints only aggregates, so it's safe to post.

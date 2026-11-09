# Live verification

deja's claims are checked against the real Anthropic API, using the provider's own `usage` numbers that the proxy records in the ledger (`in`, `cr` = cache read, `cw` = cache write). These runs used Claude Code 2.1.319 with Haiku.

## 1. Dedup keeps the prompt cache intact

Task: read `match.ts` and `render.ts`, then read both again.

```
deja claude -p "Read src/core/match.ts. Then read src/core/render.ts. Then read src/core/match.ts again. …" --model haiku --allowedTools Read
```

| request | tool results | deduped | cache read | cache write |
|---|---|---|---|---|
| 1 | 0 | 0 | 11,217 | 16,817 |
| 2 | 2 | 0 | 28,034 | 13,906 |
| 3 | 4 | 2 | **41,940** | **533** |

Request 3's cache read equals request 2's full prompt (28,034 + 13,906). Nothing earlier was invalidated, and the two re-reads cost 533 written tokens instead of about 2.9k. The model answered correctly from the first reads.

## 2. Evicted history is accepted, and the model copes

Task: six shell steps, then questions about the first outputs. Run with `--min-age 2 --uncached` to force early evictions.

| request | tool results | saved by deja | cache read | cache write |
|---|---|---|---|---|
| 1 | 0 | 0 | 11,217 | 16,898 |
| 2 | 2 | 0 | 28,115 | 13,508 |
| 3 | 3 | 0 | 41,623 | 302 |
| 4 | 4 | 2,178 | 28,345 | **10,806** |
| 5 | 5 | 2,178 | 39,151 | 102 |
| 6 | 6 | 2,178 | 39,253 | 113 |

At request 4, both `cat` outputs were replaced with stubs. The API accepted the rewritten history, and from request 5 onward the new, smaller prefix was cached again. The final answer was correct on all three points.

Request 4 also shows **why the default mode is ski rental and not eager.** The eviction forced 10.8k tokens to be re-cached, so on a short session like this one it doesn't pay off. With default settings (no `--uncached`), deja made no evictions at all on the same task, which is the cheaper choice. Evicting only becomes worthwhile over longer sessions or across idle gaps, and that's where `deja audit` finds the 20–30% savings.

## 3. The shipped defaults on a longer session

Task: read two source files, run some commands, re-read both files, then explain what two functions do. Default settings (dedup and ski-rental decay on).

| request | tool results | deduped | cache read | cache write |
|---|---|---|---|---|
| 4 | 3 | 0 | 44,144 | 721 |
| 5 | 4 | 1 | 44,865 | **167** |
| 6 | 5 | 1 | 45,032 | 1,630 |
| 7 | 6 | 2 | 46,662 | **163** |
| 8 | 7 | 2 | 46,825 | 181 |

Every request's cache read equals the previous request's read plus write *exactly* (44,865 + 167 = 45,032, 45,032 + 1,630 = 46,662, …), so the cache was never broken. The two re-reads cost 167 and 163 written tokens instead of about 1.8k each. The model's answer was correct, and it noted on its own that "the second reads returned a 'same as earlier' stub … so I relied on the first reads."

The same run measured deja's token estimator against the provider: deja's estimate of the whole prompt was **0.71×** the provider's count. The estimator undercounts on this traffic, so deja's dollar figures are conservative. `deja stats` shows this ratio for your own traffic.

## Reproduce

```bash
DEJA_HOME=/tmp/deja-test npx dejactx claude -p "…" --model haiku
node -e 'for (const l of require("fs").readFileSync("/tmp/deja-test/ledger.jsonl","utf8").trim().split("\n")) console.log(l)'
```

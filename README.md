# deja

**Your coding agent pays for the same context over and over. deja stops that, and doesn't break your prompt cache doing it.**

```
npx dejactx audit      # what did stale context cost you? (reads local history, sends nothing)
npx dejactx claude     # run Claude Code through deja
```

On 44 real Claude Code sessions (2,667 API requests), replayed request by request with exact prompt-cache billing:

| strategy | input bill | average prompt |
|---|---|---|
| as it happened | $197 | 86.7k tokens |
| eager pruning (what context pruners do) | −19.1% | 50.4k |
| **deja** | **−31.5%** | **54.9k** |

Run `npx dejactx audit` to get this table for your own history.

---

## The problem nobody measures

Every API request an agent makes resends the **entire** conversation. A 400-line `npm test` log the agent glanced at once rides along in every request after that. In the sessions above, tool output alone was **1.3M tokens when counted once, but 76M tokens actually sent**, because each result was resent about **58 times** on average.

Prompt caching makes those resends cheaper (0.1× price), but not free. They also fill the context window, which triggers lossy auto-compaction sooner.

The obvious fix is to prune old tool output. **It backfires.** The prompt cache matches on an exact prefix, so editing an old message invalidates everything after it, and the whole tail is re-billed at 1.25×. Prune eagerly and you keep paying for cache rewrites. In the replay, eager pruning that waits 20 requests before pruning cost **26% more than doing nothing at all**:

| output counts as stale after | eager pruning | deja |
|---|---|---|
| 5 requests | −19.1% | **−31.5%** |
| 10 requests | ±0.0% | **−27.5%** |
| 20 requests | **+26.3%** | **−22.4%** |

(Reproduce with `npx dejactx audit --min-age 20`.)

## How deja works

deja is a local proxy between your agent and the Anthropic API (`ANTHROPIC_BASE_URL`). It has two engines.

### 1. Dedup: back-references that never touch the cache

Each new tool result is compressed against everything already visible in the conversation, LZ77-style, with the conversation itself as the dictionary. When the agent re-reads a file it just edited, only the changed lines go through:

```
⟪deja: 212 lines, 205 of them identical to text already visible earlier in this conversation …⟫
  1-39	⟨same as Read src/app.ts lines 1-39⟩
    40	  const retries = 5;
    41	  const backoff = exponential(250);
 42-212	⟨same as Read src/app.ts lines 40-210⟩
```

The key property is that **the rewrite of message *k* is a pure function of messages 0..k.** Earlier messages come out byte-identical on every request, so the provider's prompt cache keeps hitting. Line-number gutters are matched separately from content, so an insertion that shifts every later line still matches.

**Verified on the live API.** Here's Claude Code 2.1 through deja, reading two files and then re-reading both. These are the usage numbers Anthropic returned:

| request | tool results | deduped by deja | cache read | cache write |
|---|---|---|---|---|
| 1 | 0 | 0 | 11,217 | 16,817 |
| 2 | 2 | 0 | 28,034 | 13,906 |
| 3 | 4 | 2 | **41,940** | **533** |

Request 3 read the *entire* previous prompt from cache (28,034 + 13,906 = 41,940). The only new tokens written were the two re-reads, which came through as references. The model answered correctly from the first reads. ([Full verification log](docs/verification.md), including a live eviction test.)

### 2. Decay: cache-aware eviction (ski rental)

Stale tool output, and the bodies of files the agent wrote long ago, can be replaced with small stubs that say how to get the content back ("run the tool again", "read the file"). The real question is *when* to do it:

- **Keeping** *D* stale tokens costs *rent*: *D* × 0.1 on every request.
- **Evicting** them changes the prompt at position *p*, so the suffix *S* after *p* must be re-cached once. That's a *purchase* of 1.25 × (*S* − *D*) − 0.1 × *S*.

This is the classic **ski-rental problem**. deja pays rent until the rent paid equals the purchase price, then buys. That rule is provably never worse than **2× the optimal schedule**, without knowing how long the session will last. And when you've been idle longer than the cache TTL, the cache is already gone, so eviction is free and deja does it immediately.

Evictions are sticky and persisted, so after an eviction the new prefix is stable and cacheable again.

## Install and use

Requires Node 20+.

```bash
# See what you'd save, from your local Claude Code history (~/.claude/projects)
npx dejactx audit
npx dejactx audit --since 7d --project my-app

# Run Claude Code through deja (any claude flags work after `claude`)
npx dejactx claude
npx dejactx claude --resume

# Or run the proxy yourself and point any Anthropic-API agent at it
npx dejactx start            # http://127.0.0.1:8787
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787

# Wrap any other agent
npx dejactx run -- aider --model sonnet

# What has deja saved so far?
npx dejactx stats
```

| flag | meaning |
|---|---|
| `--no-decay` | dedup only: never stub anything |
| `--off` | forward requests untouched (for A/B comparisons) |
| `--upstream <url>` | forward somewhere else (defaults to `$ANTHROPIC_BASE_URL`, so deja can sit in front of a corporate gateway) |

## Safety

- **Fails open.** If deja can't parse or transform a request, it forwards the original bytes.
- **No content is stored.** The ledger (`~/.deja/ledger.jsonl`) records token counts only, and decay state records tool-use ids only.
- **Nothing leaves your machine** except the request your agent was already making.
- **Errors are never compressed.** A failing tool result is always shown verbatim.
- **Everything is recoverable.** References point at text still in context. Stubs only replace content the environment can recreate (re-run the command, re-read the file), and they keep the first and last lines.
- **No dependencies at runtime.**

## FAQ

**Does this break prompt caching?**
Dedup can't: it never edits earlier messages. Decay does edit them, but only when the ski-rental rule says the rewrite has paid for itself, or when the cache has already expired. The audit bills every strategy with an exact-prefix cache model, so any cache breakage would show up as cost.

**Will the model get confused?**
References are plain text the model reads like any other annotation, and they point at content that's still in context. Stubs tell the model exactly how to get the content back. Decay only touches output that has sat unused for several requests.

**What about Claude Code's own compaction?**
It still works. deja just pushes it further away. Compaction summaries are lossy, while deja's references are exact.

**How accurate are the audit numbers?**
They're estimates: tokens come from a fast local counter, and dollars from a model of Anthropic's prompt caching (5-minute TTL, 1.25× writes, 0.1× reads, a 20k-token system prompt). The relative comparison between strategies is the robust part. `deja stats` reports what the live proxy actually removed.

## Development

```bash
npm install
npm test          # vitest
npm run build     # tsc → dist/
node dist/cli.js audit
```

The interesting code:

- `src/core/match.ts`: the LZ77-style line matcher
- `src/anthropic/transform.ts`: the prefix-deterministic request rewrite
- `src/decay/policy.ts`: ski-rental eviction
- `src/audit/billing.ts`: the exact-prefix prompt-cache billing model
- `src/audit/replay.ts`: strategy replays over real transcripts

## License

MIT

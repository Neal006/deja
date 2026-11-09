# Benchmarks

All numbers come from `deja audit`, which replays recorded Claude Code sessions request by request under each strategy and bills them with an exact-prefix prompt-cache model. Nothing is simulated about the conversations themselves: they're real sessions, replayed byte for byte.

## Dataset

48 Claude Code sessions (2,779 API requests) from one developer's machine, July–November 2026. The work was mixed: web apps, data pipelines, firmware docs, infra scripts, and this repository. The dominant model was Claude Opus.

## Results

Change in total input cost relative to the session as recorded (negative = cheaper). "Stale after" is `--min-age`: how many requests an item must sit unused before it can be stubbed.

| stale after | eager pruning | deja dedup only | **deja** | avg prompt: recorded → deja |
|---|---|---|---|---|
| 3 requests | −22.9% | −0.5% | **−32.4%** | 88.8k → 55.3k |
| 5 (default) | −14.1% | −0.5% | **−30.4%** | 88.8k → 57.2k |
| 10 requests | **+3.1%** | −0.5% | **−26.4%** | 88.8k → 61.5k |
| 20 requests | **+26.0%** | −0.5% | **−21.1%** | 88.8k → 67.4k |

Reading the table:

- **Eager pruning gets *worse* the more conservative it is.** Waiting longer means each prune invalidates a bigger cached suffix. At 20 requests it costs 26% *more* than not pruning at all.
- **deja is cheaper than recorded at every setting**, because it only evicts when the ski-rental rule says the cache rewrite has paid for itself (or when the cache has already expired).
- **Dedup alone is small** (0.5%) on Claude Code, which already avoids many verbatim re-reads. Its value is that it's free: it never edits old messages, so it never costs a cache rewrite.
- Eager pruning can shrink the average prompt *more* than deja and still cost more money. Prompt size isn't the bill; cache behaviour is.

## How often stubbed output was needed again

The replay can't show how the model would have reacted to stubs, but it can show how often the agent went back to the same thing anyway. Of the 711 outputs deja would have stubbed, the agent later called the same target again (same file, same command) for **177 (24.9%)**. Those calls happened in the recorded history *without* deja, mostly re-running tests or re-reading a file after editing it, so stubbing those outputs costs nothing extra. The live proxy tracks the same number (`deja stats`, "later re-run"), where it's an upper bound on re-fetches caused by stubs.

## Without a prompt cache

Local models and many OpenAI-compatible endpoints don't cache prompts, so every token of every request is billed (or computed) in full. `deja audit --uncached` replays the same history under that model:

| strategy | input tokens | avg prompt |
|---|---|---|
| as recorded | — | 91.8k |
| eager pruning | −40.9% | |
| **deja `--uncached`** | **−41.5%** | **53.7k** |

With no cache there's no rewrite penalty, so evicting eagerly is right, and that's what `--uncached` does (plus dedup). The difference from the cached case is the point: the right eviction policy depends on the provider's cache, and deja picks it from one flag.

## Auto-compaction headroom

Claude Code compacts the conversation when the context fills up, and compaction summaries lose detail. In this dataset it compacted 9 times. At each of those moments the recorded context held **137.0k tokens** on average. Replayed with deja, the same moments would have held **77.2k**: 43.7% less, so compaction would have fired much later or not at all in shorter sessions.

## Methodology

1. **Parsing.** Each transcript (`~/.claude/projects/**/*.jsonl`) is turned back into API messages: split assistant lines with the same message id are merged, parallel tool results are merged, and each compaction boundary starts a new segment. Subagent transcripts are separate sessions.
2. **Requests.** Every assistant message is the response to one request that carried all earlier messages. That request is reconstructed and transformed under the strategy.
3. **Billing.** Every transformed message is hashed. Messages that match the previous request's prefix are billed as cache reads (0.1×); everything from the first difference on is billed as a cache write (1.25×). A request more than 5 minutes after the previous one (by real timestamps) is billed entirely as writes. A constant 20k-token system prompt sits in front of every request.
4. **Tokens** come from deja's fast estimator, which undercounts: on a live Claude Code prompt it read 0.71× the provider's count. Absolute dollar figures are therefore conservative, while percentages compare strategies under the same estimator and are unaffected.
5. **Dollars** use the dominant model's base input price. Only input is modelled. Output tokens are unaffected by deja.

What this doesn't capture: whether the model would have behaved differently after seeing stubs. For example, it might re-run a command, which would cost a tool call. `--min-age` and liveness tracking (an Edit keeps a file's content alive) exist to make that rare. See [verification.md](verification.md) for live runs.

## Reproduce on your own history

```bash
npx dejactx audit                    # last 30 days, default settings
npx dejactx audit --since 90d --min-age 10
npx dejactx audit --json > audit.json
npx dejactx audit --share            # content-free summary card
```

Please share your numbers through the issue template so the defaults can be tuned on more than one person's work.

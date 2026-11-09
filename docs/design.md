# How deja works

deja rewrites the conversation an agent sends to the model, between the agent and the API. This document covers the two engines, the invariant that keeps them compatible with prompt caching, and the cost model behind every decision.

## Where tokens go

An agent turn is one API request carrying the *whole* conversation so far. Replaying 44 real Claude Code sessions:

- tool output counted once: **1.32M tokens**
- tool output as actually sent: **77.8M tokens**
- average number of later requests each tool result rides along in: **~58**
- share of tool output that exactly repeats something already in context: **≤ 6%** (line-level upper bound)

So the big cost isn't repetition. It's **persistence**: output that mattered for one step gets billed for the rest of the session. Prompt caching cuts the price of that persistence to 10%, and that's the constraint everything below is built around.

## The prompt cache, as a cost model

Anthropic's cache (OpenAI's is similar) matches the request against previous ones by **exact prefix**. For a request whose first *k* tokens match a recent request:

| part | price (× base input) |
|---|---|
| matched prefix (cache read) | 0.1 |
| everything after the first difference (cache write) | 1.25 (OpenAI: 1.0) |
| any request after more than TTL of idleness (5 min by default) | 1.25 for everything |

The consequence: **editing message *p* re-bills every token after *p* at the write price.** A context optimiser that ignores this can easily cost more than it saves.

## Invariant: prefix determinism

> The rewritten form of message *k* is a pure function of the original messages 0..*k* (and of the eviction set).

Each request is transformed from scratch, statelessly. Under this invariant every message the agent already sent comes out byte-for-byte the same as last time, so the cache prefix keeps matching. `src/audit/replay.ts` relies on the invariant to reuse hashes between replayed requests. If it ever broke, replay costs would jump, and the live verification in [verification.md](verification.md) would show cache reads falling short of the previous prompt.

## Engine 1: dedup

`src/core/match.ts`, `src/core/compress.ts`, `src/anthropic/transform.ts`

1. Walk the messages in order. Every *visible* line of every earlier tool result (and of files the agent wrote with `Write`) goes into a dictionary keyed by line content.
2. For each new tool result, run a greedy LZ77-style parse over its lines: at each position, take the longest run of lines that also appears, contiguously, in one earlier visible block. Ties go to the most recent source.
3. Runs of at least 6 lines and 160 non-space characters become references, e.g. `⟨same as Read src/app.ts lines 40-208⟩`. Everything else stays literal.
4. Keep the rewrite only if it saves at least 100 tokens and 20%.

Details that matter:

- **Gutters.** Read tools prefix lines with numbers (`    42→`). Matching ignores the gutter, so inserting one line doesn't make the rest of the file "different". References cite the source's own line numbers.
- **No reference chains.** Only literally visible lines are indexed, so a reference never points at another reference.
- **Fail-open.** Errors and unknown content pass through untouched.

Dedup only edits the newest message (old ones come out identical by the invariant), so its cache cost is zero.

## Engine 2: decay

`src/decay/inventory.ts`, `src/decay/policy.ts`, `src/decay/stub.ts`

Decay replaces stale content with stubs:

```
⟪deja: stale output of Bash `npm test` (412 lines, ~5.1k tokens) removed from context after it went unused. Run the tool again if you need it.⟫
> vitest run
…
 Test Files  42 passed (42)
      Tests  611 passed (611)
```

Stub candidates are tool results and the long string arguments of write/edit tools (types are preserved, so the history still fits each tool's schema). An item becomes a candidate once it's been carried by `minAge` requests (default 5) and stubbing it saves at least `minSaving` tokens (default 150).

### When to evict: ski rental

Let *D* be the tokens saved by stubbing the current candidates, *p* the earliest message they live in, and *S* the cached tokens from *p* to the end of the previous request.

- **Rent.** Keeping them costs 0.1·*D* on every request.
- **Buy.** Evicting now costs this request 1.25·(*S* − *D*) instead of 0.1·*S*, a one-off premium *B* = max(0, 1.25·(*S* − *D*) − 0.1·*S*).

Not knowing how many more requests the session will make, the deterministic rule "**accumulate rent; buy once the rent paid reaches *B***" is 2-competitive, the classic ski-rental result. deja implements exactly that rule, per conversation, with these refinements:

- **Free purchases.** If the previous request was more than one cache TTL ago (it detects the 1-hour TTL when the client asks for it), the cache has expired and every token will be written anyway, so *B* = 0 and deja evicts immediately.
- **Batching.** All current candidates are bought together, so one cache rewrite covers many items.
- **Stickiness.** Evicted ids are remembered (and persisted under `~/.deja`), so every later request stubs the same items in the same way and the new prefix is cache-stable.
- **Cacheless providers** (`--uncached`): no cache means no rewrite cost, so *B* = 0 always.

### Interaction with dedup

Decay runs first. Evicted content is never indexed, so dedup can't point a reference at it. A later result that used to be a reference to now-evicted text is simply shown in full, and because it sits after *p* it's being rewritten anyway.

## Measuring: replay with exact-prefix billing

`src/audit/billing.ts`, `src/audit/replay.ts`

`deja audit` reconstructs each recorded Claude Code session (merging split assistant lines, starting a new segment at compaction boundaries), then replays it request by request under four strategies:

- **baseline**: what was actually sent
- **eager**: stub everything older than `minAge` on every request (what typical pruners do)
- **dedup**: engine 1 only
- **deja**: both engines

Each replayed request is billed by hashing every message and comparing it with the previous request: the shared prefix is billed as cache reads and the rest as writes, with the real timestamps deciding TTL expiry. Nothing is assumed about cache friendliness; it's measured on the bytes.

## Known limitations

- Token counts are estimates (a fast character-class heuristic), within roughly 10–15% of real tokenizers on code and logs.
- The system prompt is modelled as a constant 20k tokens.
- A stub is lossy by design. The model can recover the content by re-running the tool, which costs a tool call. `minAge` controls how cautious decay is.
- Thinking blocks from earlier turns are ignored, matching how the API bills them.

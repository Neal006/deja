# Library API

`npm i dejactx`. ESM only, Node 20+, no runtime dependencies.

## In-process: `dejaFetch(options?)`

Returns a `fetch` that rewrites Anthropic Messages, OpenAI Chat Completions and OpenAI Responses requests the way the proxy does, and passes everything else through.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { dejaFetch } from "dejactx";

const client = new Anthropic({ fetch: dejaFetch({ onRequest: (e) => console.log(e.stats) }) });
```

| option | default | meaning |
|---|---|---|
| `fetch` | `globalThis.fetch` | the fetch to wrap |
| `decay` | `true` | `false` for dedup only |
| `decayConfig` | `DEFAULT_DECAY` | `minAge`, `minSaving`, `uncached`, `skipTools`, cache multipliers |
| `statePath` | in memory | persist decay state to this file |
| `onRequest` | none | called with a `ProxyEvent` per rewritten request |

## Proxy: `createProxy(options?)`

Returns a `node:http` `Server`. Listen on it and point an agent's base URL at it.

```ts
import { createProxy, StateStore } from "dejactx";

const server = createProxy({
  upstream: "https://api.anthropic.com",
  decay: { store: new StateStore("/tmp/deja-state.json") },
  onRequest: (e) => console.log(e.stats, e.usage),
});
server.listen(8787, "127.0.0.1");
```

`ProxyEvent` fields: `path`, `model`, `stats` (`toolResults`, `compressed`, `tokensBefore`, `tokensAfter`, `freshSaved`, `evictedResults`, `evictedInputs`, `rerunsOfStubbed`), `ms`, `decay` (`reason`, `newlyEvicted`, `evicted`), `usage` (provider-reported `input`, `cacheRead`, `cacheWrite`, `output`), `status`, `estimatedPrompt`.

## Engines

```ts
import { transformRequest, transformChatRequest, transformResponsesRequest, decide, freshState } from "dejactx";

const state = freshState();                       // one per conversation
const { evict } = decide(body, state, Date.now());  // ski-rental decision
const { body: rewritten, stats } = transformRequest(body, { evict });
```

- `transformRequest(body, { evict?, skipTools?, compress?, onResult? })` takes an Anthropic Messages body. It's pure and prefix-deterministic.
- `transformChatRequest` and `transformResponsesRequest` do the same for the OpenAI formats.
- `decide(body, state, now, config?)` returns `{ evict, newlyEvicted, reason, rent, purchase }` and updates `state`.
- `compressText(id, label, text, dictionary)` is the dedup primitive.

## Measurement

```ts
import { readTranscript, replayAll, CacheBiller, estimateTokens } from "dejactx";

const t = readTranscript("~/.claude/projects/<project>/<session>.jsonl");
for (const seg of t.segments) {
  const bills = replayAll(seg, { cwd: t.cwd });   // baseline, eager, dedup, deja
  console.log(1 - bills.deja!.cost / bills.baseline!.cost);
}
```

`CacheBiller` bills a sequence of requests with exact prefix matching (`charge(hashes, tokens, time)`). `estimateTokens(text)` is the fast estimator used everywhere.

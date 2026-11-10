# deja

[![npm](https://img.shields.io/npm/v/dejactx?color=8a2be2)](https://www.npmjs.com/package/dejactx)
[![downloads](https://img.shields.io/npm/dm/dejactx)](#downloads-and-usage)
[![ci](https://github.com/Neal006/deja/actions/workflows/ci.yml/badge.svg)](https://github.com/Neal006/deja/actions/workflows/ci.yml)
[![deja](https://img.shields.io/badge/deja---30.7%25%20input%20bill-8a2be2)](#the-problem-nobody-measures)
![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Your coding agent pays for the same context over and over. deja stops that, and doesn't break your prompt cache doing it.**

```
npx dejactx audit      # what did stale context cost you? (reads local history, sends nothing)
npx dejactx claude     # run Claude Code through deja
```

> **The npm package is `dejactx`, not `deja`.** The `deja` package on npm is an unrelated project, so never run `npx deja` or `npm i deja`. Installing `dejactx` globally (`npm i -g dejactx`) gives you the `deja` command used below.

On 51 real Claude Code sessions (2,922 API requests), replayed request by request with exact prompt-cache billing:

| strategy | input bill | average prompt |
|---|---|---|
| as it happened | — | 95.8k tokens |
| eager pruning (what context pruners do) | −15.8% | 56.8k |
| **deja** | **−30.7%** | **61.5k** |

It also means fewer forgetful moments. In this history, Claude Code auto-compacted its context 9 times, each time with about **137k tokens** in context. With deja, the same moments would have held about **77k**, so compaction (and the detail it throws away) comes much later.

([Full benchmarks and methodology](docs/benchmarks.md).)

<p align="center"><img src="docs/audit.svg" alt="deja audit output: input bill cut by 30%, eager pruning only 14%" width="760"></p>

Run `npx dejactx audit` to get this table for your own history, and `npx dejactx audit --share` for a card you can post.

---

## The problem nobody measures

Every API request an agent makes resends the **entire** conversation. A 400-line `npm test` log the agent glanced at once rides along in every request after that. In the sessions above, tool output alone was **1.3M tokens when counted once, but 76M tokens actually sent**, because each result was resent about **58 times** on average.

Prompt caching makes those resends cheaper (0.1× price), but not free. They also fill the context window, which triggers lossy auto-compaction sooner.

The obvious fix is to prune old tool output. **It backfires.** The prompt cache matches on an exact prefix, so editing an old message invalidates everything after it, and the whole tail is re-billed at 1.25×. Prune eagerly and you keep paying for cache rewrites. In the replay, eager pruning that waits 20 requests before pruning cost **22% more than doing nothing at all**:

| output counts as stale after | eager pruning | deja |
|---|---|---|
| 5 requests | −15.8% | **−30.7%** |
| 10 requests | +0.2% | **−27.0%** |
| 20 requests | **+21.6%** | **−21.9%** |

(Reproduce with `npx dejactx audit --min-age 20`.)

## How deja works

deja is a local proxy between your agent and the Anthropic API (`ANTHROPIC_BASE_URL`). It has two engines.

### 1. Dedup: back-references that never touch the cache

Each new tool result is compressed against everything already visible in the conversation, LZ77-style, with the conversation itself as the dictionary. When the agent re-reads a file it just edited, only the changed lines go through:

```
⟪deja: 212 lines; 205 unchanged ones are shown as ⟨references⟩ to identical text still earlier in your context.⟫
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

This is the classic **ski-rental problem**. deja pays rent until the rent paid equals the purchase price, then buys. In the textbook version (one item, a fixed purchase price) that rule is never worse than **2× the best schedule chosen in hindsight**, without knowing how long the session will last. Real sessions have many items and a purchase price that moves, so deja doesn't claim a proof there; [an end-to-end test](docs/design.md#checked-not-just-claimed) checks the 2× bound on randomized sessions instead. And when you've been idle longer than the cache TTL, the cache is already gone, so eviction is free and deja does it immediately.

Evictions are sticky and persisted, so after an eviction the new prefix is stable and cacheable again.

## How deja compares

| approach | what it does | prompt cache | the catch |
|---|---|---|---|
| **auto-compaction** (built into agents) | summarises the conversation when the window fills | rebuilt from scratch | lossy, and only kicks in at the limit |
| **Claude Code's unchanged re-read check** (built in) | answers a Read of an unchanged file with "unchanged since last read" | preserved | exact repeats of `Read` only: misses edited files, partial ranges and repeated `Bash` output; complementary to deja |
| **Anthropic context editing** (`clear_tool_uses`, server-side) | clears the oldest tool results once the prompt passes a token threshold | broken at the clear point | you pick fixed thresholds (`trigger`, `keep`, `clear_at_least`) yourself; no idle-cache awareness or dedup; your agent must send the setting |
| **eager context pruning** | drops old tool results as soon as they're old | broken on every prune | can cost *more* than doing nothing (see above) |
| **TTL-only pruning** | prunes only after the cache has expired | preserved | misses every saving inside an active session |
| **output filters** (shorter test/build logs) | shrink tool output before the agent sees it | unaffected | lossy at the source; complementary to deja |
| **repo maps / code search tools** | help the agent read less | unaffected | complementary to deja |
| **deja** | exact back-references and cost-modelled eviction | preserved, or rebuilt only when it pays off | stubs are lossy by design, but the content is re-creatable |

## Install and use

Requires Node 20+. Every command works two ways: `npx dejactx <command>` with nothing installed, or `deja <command>` after `npm i -g dejactx`.

```bash
# See what you'd save, from your local Claude Code history (~/.claude/projects)
npx dejactx audit
npx dejactx audit --since 7d --project my-app
npx dejactx audit --tune          # find the best --min-age for how *you* work
npx dejactx audit --agent codex   # replay Codex CLI history (~/.codex/sessions) instead

# Run Claude Code through deja: deja's flags go before `claude`, Claude Code's after it
npx dejactx claude
npx dejactx claude --resume
npx dejactx --min-age 10 claude --model opus

# Or run the proxy yourself and point any Anthropic-API agent at it
npx dejactx start            # http://127.0.0.1:8787
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787

# Wrap any other agent
npx dejactx run -- aider --model sonnet

# What has deja saved so far?
npx dejactx stats
```

### Live savings in Claude Code's status line

Install globally and let deja configure it:

```bash
npm i -g dejactx
deja setup statusline      # adds the statusLine entry to ~/.claude/settings.json (with a backup)
```

Sessions started with `deja claude` then show something like `deja ↓45.6k tok · $0.42 · 3 stubbed` at the bottom of the screen.

### OpenAI-compatible agents

deja also understands the OpenAI Chat Completions format, so it works with Cline, Roo, OpenCode, aider, Continue, OpenRouter, vLLM or Ollama, anything that lets you set a base URL:

```bash
npx dejactx run --openai -- aider --model gpt-5           # wraps the agent
npx dejactx start --upstream https://openrouter.ai/api     # or point the agent's base URL at http://127.0.0.1:8787/v1
```

For providers with no prompt cache at all (most local models), add `--uncached`: every request is billed in full there, so stale output is evicted as soon as it goes stale. Replaying the same 51 sessions that way, deja cuts **41.3% of input tokens** (`deja audit --uncached`).

| flag | meaning |
|---|---|
| `--no-decay` | dedup only: never stub anything |
| `--off` | forward requests untouched (for A/B comparisons) |
| `--openai` | wrap an OpenAI-compatible agent (sets `OPENAI_BASE_URL`) |
| `--uncached` | the upstream has no prompt cache: evict eagerly |
| `--min-age <n>` | requests before output counts as stale (default 5) |
| `--upstream <url>` | forward somewhere else (defaults to `$ANTHROPIC_BASE_URL`, so deja can sit in front of a corporate gateway) |

### Inside your own agent

Building on the Anthropic or OpenAI SDK, or the Claude Agent SDK's underlying client? Use deja in-process instead of as a proxy:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { dejaFetch } from "dejactx";

const client = new Anthropic({ fetch: dejaFetch() });
```

`dejaFetch` rewrites Messages, Chat Completions and Responses API calls exactly as the proxy does, and passes everything else through. The engines (`transformRequest`, `decide`, `CacheBiller`, …) are exported too. See [docs/api.md](docs/api.md).

To send one request untouched, add the header `x-deja: off`. deja strips the header and forwards the original bytes. A running proxy also answers `GET /deja/health` with its upstream and running totals.

## Safety

- **Fails open.** If deja can't parse or transform a request, it forwards the original bytes.
- **No content is stored.** The ledger (`~/.deja/ledger.jsonl`) records token counts only, and decay state records tool-use ids only. See [docs/data.md](docs/data.md) for every field.
- **Nothing leaves your machine** except the request your agent was already making.
- **Errors are never compressed.** A failing tool result is always shown verbatim.
- **Everything is recoverable.** References point at text still in context. Stubs only replace content the environment can recreate (re-run the command, re-read the file), and they keep the first and last lines.
- **No dependencies at runtime.**

## FAQ

**Does this break prompt caching?**
Dedup can't: it never edits earlier messages. Decay does edit them, but only when the ski-rental rule says the rewrite has paid for itself, or when the cache has already expired. The audit bills every strategy with an exact-prefix cache model, so any cache breakage would show up as cost.

**Will the model get confused?**
References are plain text the model reads like any other annotation, and they point at content that's still in context. Stubs tell the model exactly how to get the content back. Decay only touches output that has sat unused for several requests, never touches user answers, subagent reports or skills, and keeps a file's contents while the agent is still editing it. In the replay, a quarter of the outputs deja would stub were called again later anyway, without deja. `deja stats` tracks the same rate live, and `npm run bench:quality` runs real coding tasks with deja on and off and compares how many pass. So far every run has passed with deja on, on both Haiku and Sonnet, with no extra turns ([results](docs/benchmarks.md#task-success-does-the-agent-still-finish-the-job)).

**What about Claude Code's own compaction?**
It still works. deja just pushes it further away. Compaction summaries are lossy, while deja's references are exact.

**How accurate are the audit numbers?**
They're estimates. Tokens come from a fast local counter that undercounts (0.71× the provider's figure on a live Claude Code prompt), so dollar amounts are conservative. Costs come from a model of Anthropic's prompt caching: 5-minute TTL, 1.25× writes, 0.1× reads, a 20k-token system prompt. The percentages compare strategies under the same estimator and cache model, which makes them the robust part. `deja stats` reports what the live proxy actually removed, alongside the provider's own cache numbers.

**Does it work with Codex CLI?**
Codex talks to the OpenAI Responses API, which deja supports. Point Codex's provider base URL at `http://127.0.0.1:8787/v1` after `deja start --upstream https://api.openai.com`, or try `deja run --openai -- codex`.

**Can I use it in CI?**
Yes. See [docs/ci.md](docs/ci.md) for headless runs and GitHub Actions.

**Something looks off.**
See [docs/troubleshooting.md](docs/troubleshooting.md), and run `deja doctor`.

## Downloads and usage

Live numbers, updated automatically (npm counts lag by about a day):

| | |
|---|---|
| npm version | [![npm](https://img.shields.io/npm/v/dejactx?color=8a2be2&label=dejactx)](https://www.npmjs.com/package/dejactx) |
| downloads this week | [![weekly](https://img.shields.io/npm/dw/dejactx)](https://npm-stat.com/charts.html?package=dejactx) |
| downloads this month | [![monthly](https://img.shields.io/npm/dm/dejactx)](https://npm-stat.com/charts.html?package=dejactx) |
| downloads, last 18 months | [![total](https://img.shields.io/npm/d18m/dejactx)](https://npm-stat.com/charts.html?package=dejactx) |
| GitHub stars | [![stars](https://img.shields.io/github/stars/Neal006/deja?style=flat)](https://github.com/Neal006/deja/stargazers) |

- **Daily download chart:** [npm-stat.com/charts.html?package=dejactx](https://npm-stat.com/charts.html?package=dejactx) (pick any date range)
- **Raw numbers** from npm's API: [last week](https://api.npmjs.org/downloads/point/last-week/dejactx) · [per day, last month](https://api.npmjs.org/downloads/range/last-month/dejactx)
- **Savings people report:** [savings reports](https://github.com/Neal006/deja/issues?q=label%3Asavings-report) from `deja audit --share`

<a href="https://star-history.com/#Neal006/deja&Date"><img src="https://api.star-history.com/svg?repos=Neal006/deja&type=Date" alt="Star history of Neal006/deja" width="600"></a>

## Status and roadmap

deja 0.1 is [on npm](https://www.npmjs.com/package/dejactx). The engines are fuzz-tested, the cost model is checked against the hindsight optimum, and the proxy has been verified live against the Anthropic API. The audit numbers come from one developer's history, though, so run `npx dejactx audit` on yours and [share the summary](https://github.com/Neal006/deja/issues/new?template=savings_report.md).

Next up:

- `deja audit` for more agents' transcripts (Claude Code and Codex are supported; Cline and OpenCode next)
- per-tool stub formats (`git diff`, package managers, test runners)
- live A/B mode: send a sample of requests untouched and compare provider-billed cost

## Development

```bash
npm install
npm test               # vitest (fuzzing, end-to-end, competitive-ratio checks)
npm run typecheck      # tsc over src and tests
npm run build          # tsc → dist/
node dist/cli.js audit
npm run bench:quality  # task-success benchmark, deja on vs. off (calls the real API)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for ground rules and how releases are cut.

The design, with the cost model and the ski-rental analysis, is in [docs/design.md](docs/design.md). The interesting code:

- `src/core/match.ts`: the LZ77-style line matcher
- `src/anthropic/transform.ts`: the prefix-deterministic request rewrite
- `src/decay/policy.ts`: ski-rental eviction
- `src/audit/billing.ts`: the exact-prefix prompt-cache billing model
- `src/audit/replay.ts`: strategy replays over real transcripts

## Contributors

- [Neal Daftary](https://github.com/Neal006): creator and maintainer
- [Nandini Rathod](https://github.com/nandinirathod2321): agent adapter registry for `deja audit` ([#2](https://github.com/Neal006/deja/pull/2))

Want to be on this list? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

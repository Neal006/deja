# Contributing to deja

Thanks for helping agents stop paying twice.

## Setup

```bash
git clone https://github.com/Neal006/deja && cd deja
npm install
npm test
npm run build && node dist/cli.js doctor
```

Node 20+ is required. There are no runtime dependencies, so please keep it that way.

## Ground rules

1. **Never break the prefix invariant.** The rewrite of message *k* must depend only on messages 0..*k* (and the eviction set). If you change matching or rendering, add a test proving an earlier message renders identically when the conversation grows (see `test/transform.test.ts`).
2. **Fail open.** Anything deja doesn't understand must pass through byte for byte.
3. **Measure, don't guess.** Changes that affect savings should come with `deja audit` numbers before and after. Paste only the summary lines: no conversation content.
4. **No content at rest.** The ledger and decay state store counts and ids only.

## Where things live

| path | what |
|---|---|
| `src/core/` | line model, matcher, rendering, token estimate, ledger, pricing |
| `src/anthropic/` | Messages API types and the request transform |
| `src/openai/` | Chat Completions adapter onto the same engine |
| `src/decay/` | inventory, ski-rental policy, stubs, persisted state |
| `src/proxy/` | the HTTP proxy, usage sniffing, ledger recording |
| `src/audit/` | transcript parsing, billing model, strategy replay, reports |
| `src/cli/` | commands and formatting |

## Good first issues

- Support another agent's transcript format in `deja audit` (Codex, Cline, OpenCode…)
- Better stubs for specific tools (test runners, package managers, `git diff`)
- Support the OpenAI Responses API in the proxy

## Commits

Small, focused commits with conventional prefixes (`feat:`, `fix:`, `docs:`, `test:`, `perf:`, `refactor:`, `chore:`).

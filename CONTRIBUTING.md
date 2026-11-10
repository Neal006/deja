# Contributing to deja

Thanks for helping agents stop paying twice.

## Setup

```bash
git clone https://github.com/Neal006/deja && cd deja
npm install
npm test
npm run typecheck
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
| `src/openai/` | Chat Completions and Responses API adapters onto the same engine |
| `src/decay/` | inventory, ski-rental policy, stubs, persisted state |
| `src/proxy/` | the HTTP proxy, usage sniffing, ledger recording |
| `src/fetch.ts` | `dejaFetch`, the in-process wrapper |
| `src/audit/` | transcript parsing, billing model, strategy replay, reports |
| `src/audit/agents/` | agent adapter registry and transcript parsers |
| `src/cli/` | commands and formatting |

## Good first issues

- Support another agent's transcript format in `deja audit` (Cline, OpenCode, aider…; see `src/audit/agents/codex.ts` for a small example)
- Better stubs for specific tools (test runners, package managers, `git diff`)
- More tasks for the task-success benchmark (`bench/tasks/`)

## Commits

Small, focused commits with conventional prefixes (`feat:`, `fix:`, `docs:`, `test:`, `perf:`, `refactor:`, `chore:`).

## Releasing

Maintainers with publish rights on the [`dejactx`](https://www.npmjs.com/package/dejactx) npm package:

```bash
# 1. update CHANGELOG.md (move items under a new version heading)
npm version patch            # or minor; bumps package.json and tags vX.Y.Z
git push --follow-tags
npm publish --access public  # runs build + tests first (prepublishOnly)
```

- The account needs 2FA. With an authenticator app, pass `--otp=<code>`. With a passkey, run `npm publish` in a normal terminal so npm can wait while you approve in the browser.
- npm may show a `0.0.0-stage` placeholder for a few minutes while it processes a release. Check with `npm view dejactx versions`.
- Then create the GitHub release: `gh release create vX.Y.Z --notes-file <(sed -n '/^## X.Y.Z/,/^## /p' CHANGELOG.md)`.
- To give someone publish rights: `npm owner add <npm-username> dejactx`.

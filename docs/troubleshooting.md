# Troubleshooting

Start with `deja doctor`. It checks Node, the deja home directory, Claude Code, your history and the upstream in one go.

## `deja claude` starts, but `deja stats` shows nothing

- Make sure the agent really goes through the proxy: inside the session, `echo $ANTHROPIC_BASE_URL` should print `http://127.0.0.1:<port>`.
- If you set `ANTHROPIC_BASE_URL` in `~/.claude/settings.json` (`env` block), Claude Code may override the variable deja sets. Remove it from the settings file, or run `deja start` and point that setting at the printed URL.
- `DEJA_HOME` changes where the ledger lives. `deja stats` and the proxy must agree on it.

## The status line says `deja: off`

The status line reads the port from `ANTHROPIC_BASE_URL`, so it only shows numbers in sessions started with `deja claude` (or with the base URL pointing at `deja start`). It also needs `deja` on your `PATH`: `npm i -g dejactx`.

## The model re-ran a command or re-read a file

That's how a stub is meant to be used: the content left the context after sitting unused and the model fetched it again. If it happens often for a particular tool, either:

- raise the staleness threshold: `--min-age 10` (default 5), or
- exempt the tool: `--skip-tools mcp__db__query,Grep`.

`deja preview <session>` shows exactly what the model saw at any request of a past session.

## I want to compare with and without deja

```bash
deja --off claude        # same proxy and ledger, but nothing is rewritten
deja claude              # deja on
deja stats               # the "measured by the provider" block shows real cache reads/writes
```

You can also bypass deja for a single request by sending the header `x-deja: off`.

## Corporate gateway or custom endpoint

deja forwards to `$ANTHROPIC_BASE_URL` if it was set before deja started, so it chains in front of your gateway automatically. To be explicit, use `--upstream https://gateway.example.com`. For OpenAI-compatible endpoints, use `deja run --openai --upstream <base>`.

## Windows

`deja run` launches `.cmd` shims (such as `claude.cmd` or `aider.cmd`) through `cmd.exe` with proper quoting, and real `.exe` programs directly. If an argument still arrives mangled, run `deja start` in one terminal and set `ANTHROPIC_BASE_URL` in the agent's terminal yourself.

## Resetting

Everything deja stores lives in `~/.deja` (or `$DEJA_HOME`):

| file | contents | safe to delete |
|---|---|---|
| `ledger.jsonl` | token counts per request | yes: resets `deja stats` |
| `decay-state.json` | evicted tool-use ids per conversation | yes: costs one cache rebuild per active session |
| `live/<port>.json` | status line tally of a running proxy | yes |

# deja in CI and headless runs

Agents running in CI (code review bots, issue fixers, nightly refactors) are long, unattended sessions full of build and test logs, which is exactly where stale context piles up.

## Headless Claude Code

```bash
npx dejactx claude -p "fix the failing tests" --allowedTools "Bash(npm test:*)" Read Edit
```

`deja claude` passes everything after `claude` straight to Claude Code, and prints a one-line summary of what it saved when the run ends.

## GitHub Actions

Run the proxy in the background and point the agent at it:

```yaml
- name: Start deja
  run: |
    npx -y dejactx start --port 8787 --quiet --log deja-events.jsonl &
    for i in $(seq 1 20); do curl -sf http://127.0.0.1:8787/deja/health && break; sleep 0.5; done

- name: Run the agent
  env:
    ANTHROPIC_BASE_URL: http://127.0.0.1:8787
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: npx -y @anthropic-ai/claude-code -p "review this pull request" --output-format json

- name: What deja saved
  if: always()
  run: npx -y dejactx stats
```

Notes:

- `GET /deja/health` makes a good readiness check.
- `--log` writes one JSON line per request (counts only, no content), which you can upload as a build artifact.
- CI runners are often idle long enough between steps for the prompt cache to expire. deja notices that and evicts stale output for free on the next request.
- For an OpenAI-compatible agent, start with `--upstream https://api.openai.com` (or your gateway) and point the agent's base URL at `http://127.0.0.1:8787/v1`.

## Containers

deja has no runtime dependencies and needs only Node 20+. In a container, run `deja start` as a sidecar process and set `ANTHROPIC_BASE_URL` for the agent. The proxy listens on `127.0.0.1` only, so run it in the same network namespace as the agent.

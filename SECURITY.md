# Security

deja sits on the path of your API traffic, so its security boundaries are worth spelling out:

- **It listens on 127.0.0.1 only.** It is never exposed to your network.
- **It forwards your credentials untouched** (`x-api-key` / `authorization`) to the configured upstream, and to nowhere else.
- **It stores no conversation content.** `~/.deja/ledger.jsonl` holds token counts, and `~/.deja/decay-state.json` holds tool-use ids.
- **It makes no network calls of its own**, apart from `deja doctor`'s reachability check (skip it with `--offline`).

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue. You'll get a response within a few days.

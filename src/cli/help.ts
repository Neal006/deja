export const VERSION = "0.1.0";

export const HELP = `deja ${VERSION} — déjà vu for your coding agent

Agents keep re-reading the same files and re-running the same commands, and
every repeat is billed again. deja sits between your agent and the API and
replaces anything the model has already seen with a short reference, without
ever touching earlier messages, so prompt caching keeps working.

Usage
  deja audit [--since 30d]         replay your Claude Code history: what did
                                   repeats cost you? (nothing is sent anywhere)
  deja claude [claude args...]     run Claude Code through deja
  deja run -- <cmd> [args...]      run any Anthropic-API agent through deja
  deja start [--port 8787]         run the proxy in the foreground
  deja stats [--since 7d] [--json] show what deja has saved
  deja help | --version

Options
  --upstream <url>   where to forward requests (default: $ANTHROPIC_BASE_URL
                     or https://api.anthropic.com)
  --off              forward requests untouched (A/B comparisons)
  --no-decay         dedup only: never stub stale tool output
  --min-age <n>      requests before output counts as stale (default 5)
  --min-saving <n>   smallest eviction worth making, in tokens (default 150)
  --uncached         the upstream has no prompt cache: evict stale output eagerly
  --quick            audit: skip the strategy replay
  --quiet            do not log one line per request (start)

Environment
  DEJA_HOME          where the ledger lives (default ~/.deja)
  DEJA_UPSTREAM      same as --upstream
  DEJA_INPUT_PRICE   USD per million input tokens for savings estimates
  DEJA_MIN_AGE       same as --min-age
  DEJA_MIN_SAVING    same as --min-saving
  DEJA_UNCACHED=1    same as --uncached
  NO_COLOR           disable colors
`;

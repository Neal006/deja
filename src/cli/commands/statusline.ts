import { formatTokens } from "../../core/tokens.js";
import { portFromBaseUrl, readLive, type LiveTally } from "../../proxy/live.js";
import { usd } from "../format.js";

/**
 * Print a one-line status for Claude Code's status line. Configure with
 *
 *   "statusLine": { "type": "command", "command": "deja statusline" }
 *
 * in ~/.claude/settings.json. Claude Code runs it inside the session, where
 * ANTHROPIC_BASE_URL points at the deja proxy, so we can find its tally.
 */
export function statusText(t: LiveTally | undefined): string {
  if (!t) return "deja: off";
  if (t.saved <= 0) return `deja ✓ ${t.requests} req`;
  return `deja ↓${formatTokens(t.saved)} tok · ${usd(t.usd)}${t.evicted > 0 ? ` · ${t.evicted} stubbed` : ""}`;
}

export function statuslineCommand(env: NodeJS.ProcessEnv = process.env): number {
  const port = portFromBaseUrl(env.ANTHROPIC_BASE_URL) ?? portFromBaseUrl(env.OPENAI_BASE_URL);
  process.stdout.write(`${statusText(port ? readLive(port, env) : undefined)}\n`);
  return 0;
}

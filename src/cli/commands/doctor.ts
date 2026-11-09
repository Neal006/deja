import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync } from "node:fs";
import { claudeProjectsDir, discoverTranscripts } from "../../audit/discover.js";
import { dejaHome } from "../../core/ledger.js";
import { flagString, type ParsedArgs } from "../args.js";
import { paint, useColor } from "../format.js";
import { resolveUpstream } from "../upstream.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export function checkNode(version = process.versions.node): Check {
  const major = Number(version.split(".")[0]);
  return major >= 20
    ? { name: "node", status: "ok", detail: `v${version}` }
    : { name: "node", status: "fail", detail: `v${version}; deja needs Node 20 or newer` };
}

export function checkHome(home = dejaHome()): Check {
  try {
    mkdirSync(home, { recursive: true });
    accessSync(home, constants.W_OK);
    return { name: "deja home", status: "ok", detail: home };
  } catch (err) {
    return { name: "deja home", status: "fail", detail: `${home} is not writable (${(err as Error).message}); set DEJA_HOME` };
  }
}

export function checkClaude(bin = process.env.DEJA_CLAUDE_BIN ?? "claude"): Check {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (r.error || r.status !== 0) {
    return { name: "claude code", status: "warn", detail: `"${bin}" not found; needed for \`deja claude\` (other agents work via \`deja run\`)` };
  }
  return { name: "claude code", status: "ok", detail: r.stdout.trim().split("\n")[0] ?? "found" };
}

export function checkTranscripts(dir = claudeProjectsDir()): Check {
  const n = discoverTranscripts(dir).length;
  return n > 0
    ? { name: "history", status: "ok", detail: `${n} transcripts in ${dir} (try \`deja audit\`)` }
    : { name: "history", status: "warn", detail: `no transcripts in ${dir}; \`deja audit\` will have nothing to replay` };
}

export function checkBaseUrl(env: NodeJS.ProcessEnv = process.env): Check {
  const base = env.ANTHROPIC_BASE_URL;
  if (!base) return { name: "base url", status: "ok", detail: "ANTHROPIC_BASE_URL unset; deja forwards to api.anthropic.com" };
  return { name: "base url", status: "ok", detail: `ANTHROPIC_BASE_URL=${base}; deja will chain in front of it` };
}

export async function checkUpstream(url: string, fetcher: typeof fetch = fetch): Promise<Check> {
  try {
    const res = await fetcher(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return { name: "upstream", status: "ok", detail: `${url} reachable (HTTP ${res.status})` };
  } catch (err) {
    return { name: "upstream", status: "warn", detail: `${url} unreachable: ${(err as Error).message}` };
  }
}

export function renderChecks(checks: Check[], color: boolean): string {
  const p = paint(color);
  const icon = { ok: p.green("✓"), warn: p.yellow("!"), fail: p.red("✗") };
  return checks.map((c) => `${icon[c.status]} ${c.name.padEnd(12)} ${p.dim(c.detail)}`).join("\n");
}

export async function doctorCommand(args: ParsedArgs): Promise<number> {
  const upstream = resolveUpstream(flagString(args.flags, "upstream"));
  const checks = [checkNode(), checkHome(), checkClaude(), checkTranscripts(), checkBaseUrl()];
  if (args.flags.offline !== true) checks.push(await checkUpstream(upstream));
  process.stdout.write(`${renderChecks(checks, useColor(process.stdout))}\n`);
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}

import { spawn } from "node:child_process";
import { formatTokens } from "../../core/tokens.js";
import { flagString, type ParsedArgs } from "../args.js";
import { paint, usd, useColor } from "../format.js";
import { launchArgs } from "../spawn.js";
import { resolveOpenAIUpstream, resolveUpstream } from "../upstream.js";
import { decayConfigFromArgs, startProxy } from "./start.js";

/**
 * Run an agent with deja in front of it: start a proxy on a free port, launch
 * the command with ANTHROPIC_BASE_URL pointing at the proxy, and print what
 * was saved when the agent exits.
 */
export async function wrapCommand(cmd: string, cmdArgs: string[], args: ParsedArgs): Promise<number> {
  const openai = args.flags.openai === true;
  const upstream = openai ? resolveOpenAIUpstream(flagString(args.flags, "upstream")) : resolveUpstream(flagString(args.flags, "upstream"));
  const proxy = await startProxy({
    port: 0,
    upstream,
    enabled: args.flags.off !== true,
    decay: args.flags.decay !== false,
    decayConfig: decayConfigFromArgs(args),
  });

  const env: NodeJS.ProcessEnv = { ...process.env, DEJA_ACTIVE: "1" };
  if (openai) {
    // Different agents read different variable names.
    env.OPENAI_BASE_URL = `${proxy.url}/v1`;
    env.OPENAI_API_BASE = `${proxy.url}/v1`;
  } else {
    env.ANTHROPIC_BASE_URL = proxy.url;
  }

  const code = await new Promise<number>((resolve) => {
    // On Windows most agent CLIs are .cmd shims, which need a quoted shell launch.
    const launch = launchArgs(cmd, cmdArgs);
    const child = spawn(launch.command, launch.args, { stdio: "inherit", env, shell: launch.shell });
    child.on("error", (err) => {
      process.stderr.write(`deja: could not start ${cmd}: ${err.message}\n`);
      resolve(127);
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 128 : 0)));
    // Let the agent handle Ctrl-C itself; deja just waits for it to exit.
    process.on("SIGINT", () => {});
  });

  await new Promise<void>((resolve) => proxy.server.close(() => resolve()));
  process.stderr.write(`${summaryLine(proxy.tally, useColor(process.stderr))}\n`);
  return code;
}

export function summaryLine(t: { requests: number; saved: number; usd: number }, color: boolean): string {
  const p = paint(color);
  if (t.requests === 0) return p.dim("deja: no API requests went through the proxy");
  if (t.saved === 0) return p.dim(`deja: ${t.requests} requests, nothing repeated yet`);
  return (
    `${p.magenta("deja")} saved ${p.bold(formatTokens(t.saved))} input tokens ` +
    `across ${t.requests} requests ${p.dim(`(≈ ${usd(t.usd)})`)} · run ${p.cyan("deja stats")} for the full picture`
  );
}

export function claudeCommand(args: ParsedArgs, argv: string[]): Promise<number> {
  // Everything after `claude` is forwarded, flags included.
  const i = argv.indexOf("claude");
  return wrapCommand(process.env.DEJA_CLAUDE_BIN ?? "claude", argv.slice(i + 1), args);
}

export function runCommand(args: ParsedArgs): Promise<number> {
  const [cmd, ...rest] = args.rest;
  if (!cmd) {
    process.stderr.write("usage: deja run -- <command> [args...]\n");
    return Promise.resolve(2);
  }
  return wrapCommand(cmd, rest, args);
}

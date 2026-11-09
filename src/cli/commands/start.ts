import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { dejaHome } from "../../core/ledger.js";
import { formatTokens } from "../../core/tokens.js";
import { decayFromEnv, type DecayConfig } from "../../decay/policy.js";
import { StateStore } from "../../decay/store.js";
import { appendFileSync } from "node:fs";
import { removeLive, writeLive } from "../../proxy/live.js";
import { eventRecord, recorder } from "../../proxy/record.js";
import { createProxy, type ProxyEvent } from "../../proxy/server.js";
import { flagNumber, flagString, type ParsedArgs } from "../args.js";
import { paint, useColor } from "../format.js";
import { summaryLine } from "../summary.js";
import { resolveUpstream } from "../upstream.js";

export const DEFAULT_PORT = 8787;

export interface StartedProxy {
  server: Server;
  port: number;
  url: string;
  upstream: string;
  tally: ReturnType<typeof recorder>["tally"];
}

/** Start a proxy and resolve once it is listening. Port 0 picks a free port. */
export function startProxy(opts: {
  port: number;
  upstream: string;
  enabled?: boolean;
  /** Cache-aware eviction of stale context (default on). */
  decay?: boolean;
  decayConfig?: DecayConfig;
  /** Tools never to dedup or stub. */
  skipTools?: string[];
  ledger?: string;
  onEvent?: (e: ProxyEvent) => void;
}): Promise<StartedProxy> {
  const rec = recorder(opts.ledger);
  let port = 0;
  const started = Date.now();
  const server = createProxy({
    upstream: opts.upstream,
    enabled: opts.enabled,
    transform: opts.skipTools?.length ? { skipTools: opts.skipTools } : undefined,
    status: () => ({ pid: process.pid, started, ...rec.tally }),
    decay:
      opts.decay === false
        ? undefined
        : { store: new StateStore(join(dejaHome(), "decay-state.json")), config: opts.decayConfig ?? decayFromEnv() },
    onRequest: (e) => {
      rec.onRequest(e);
      try {
        writeLive({ port, pid: process.pid, started, ...rec.tally, evicted: e.decay?.evicted ?? 0 });
      } catch {
        // The status line is a nicety; never fail a request over it.
      }
      opts.onEvent?.(e);
    },
  });
  server.on("close", () => removeLive(port));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve({ server, port, url: `http://127.0.0.1:${port}`, upstream: opts.upstream, tally: rec.tally });
    });
  });
}

export function eventLine(e: ProxyEvent, color: boolean): string {
  const p = paint(color);
  const saved = e.stats.tokensBefore - e.stats.tokensAfter;
  const model = e.model ?? "?";
  const decay = e.decay && e.decay.newlyEvicted > 0 ? p.cyan(` ⌫ decayed ${e.decay.newlyEvicted} stale (${e.decay.reason})`) : "";
  if (saved <= 0) return p.dim(`· ${model}  ${e.stats.toolResults} tool results, nothing to trim`) + decay;
  return (
    `${p.green("✓")} ${model}  ${p.bold(formatTokens(saved))} tokens not resent ` +
    p.dim(
      `(${e.stats.compressed} deduped, ${e.stats.evictedResults + e.stats.evictedInputs} stubbed, ` +
        `+${formatTokens(e.stats.freshSaved)} new, ${e.ms.toFixed(1)}ms)`,
    ) +
    decay
  );
}

/** A helpful message when the proxy cannot listen. */
export function listenError(port: number, err: NodeJS.ErrnoException): string {
  if (err.code === "EADDRINUSE") {
    return `deja: port ${port} is already in use (another deja?). Try --port 0 for a free port, or stop the other process.`;
  }
  if (err.code === "EACCES") return `deja: not allowed to listen on port ${port}. Try a port above 1024.`;
  return `deja: could not listen on port ${port}: ${err.message}`;
}

/** Decay settings from flags, falling back to the environment. */
export function decayConfigFromArgs(args: ParsedArgs): DecayConfig {
  const env = decayFromEnv();
  return {
    ...env,
    minAge: flagNumber(args.flags, "min-age") ?? env.minAge,
    minSaving: flagNumber(args.flags, "min-saving") ?? env.minSaving,
    uncached: args.flags.uncached === true ? true : env.uncached,
    skipTools: skipToolsFromArgs(args),
  };
}

/** `--skip-tools a,b` or DEJA_SKIP_TOOLS=a,b. */
export function skipToolsFromArgs(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = flagString(args.flags, "skip-tools") ?? env.DEJA_SKIP_TOOLS ?? "";
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function startCommand(args: ParsedArgs): Promise<number> {
  const color = useColor(process.stderr);
  const p = paint(color);
  const port = flagNumber(args.flags, "port") ?? Number(process.env.DEJA_PORT ?? DEFAULT_PORT);
  const upstream = resolveUpstream(flagString(args.flags, "upstream"));
  const quiet = args.flags.quiet === true;
  const logPath = flagString(args.flags, "log");
  let proxy: StartedProxy;
  try {
    proxy = await startProxy({
    port,
    upstream,
    enabled: args.flags.off !== true,
    decay: args.flags.decay !== false,
    decayConfig: decayConfigFromArgs(args),
    skipTools: skipToolsFromArgs(args),
    onEvent: (e) => {
      if (!quiet) process.stderr.write(`${eventLine(e, color)}\n`);
      if (logPath) {
        try {
          appendFileSync(logPath, `${JSON.stringify(eventRecord(e))}\n`);
        } catch {
          // Logging is best effort.
        }
      }
    },
    });
  } catch (err) {
    process.stderr.write(`${listenError(port, err as NodeJS.ErrnoException)}\n`);
    return 1;
  }
  process.stderr.write(
    `${p.magenta("deja")} listening on ${p.bold(proxy.url)} → ${upstream}\n` +
      p.dim(`point your agent at it:  export ANTHROPIC_BASE_URL=${proxy.url}\n`),
  );
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.stderr.write(`\n${summaryLine(proxy.tally, color)}\n`);
      proxy.server.close(() => resolve());
      // Idle client keep-alive connections must not hold shutdown up.
      proxy.server.closeAllConnections?.();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

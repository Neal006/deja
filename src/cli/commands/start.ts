import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { formatTokens } from "../../core/tokens.js";
import { recorder } from "../../proxy/record.js";
import { createProxy, type ProxyEvent } from "../../proxy/server.js";
import { flagNumber, flagString, type ParsedArgs } from "../args.js";
import { paint, useColor } from "../format.js";
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
  ledger?: string;
  onEvent?: (e: ProxyEvent) => void;
}): Promise<StartedProxy> {
  const rec = recorder(opts.ledger);
  const server = createProxy({
    upstream: opts.upstream,
    enabled: opts.enabled,
    onRequest: (e) => {
      rec.onRequest(e);
      opts.onEvent?.(e);
    },
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, url: `http://127.0.0.1:${port}`, upstream: opts.upstream, tally: rec.tally });
    });
  });
}

export function eventLine(e: ProxyEvent, color: boolean): string {
  const p = paint(color);
  const saved = e.stats.tokensBefore - e.stats.tokensAfter;
  const model = e.model ?? "?";
  if (saved <= 0) return p.dim(`· ${model}  ${e.stats.toolResults} tool results, nothing seen before`);
  return (
    `${p.green("✓")} ${model}  ${p.bold(formatTokens(saved))} tokens not resent ` +
    p.dim(`(${e.stats.compressed}/${e.stats.toolResults} results deduped, +${formatTokens(e.stats.freshSaved)} new, ${e.ms.toFixed(1)}ms)`)
  );
}

export async function startCommand(args: ParsedArgs): Promise<number> {
  const color = useColor(process.stderr);
  const p = paint(color);
  const port = flagNumber(args.flags, "port") ?? Number(process.env.DEJA_PORT ?? DEFAULT_PORT);
  const upstream = resolveUpstream(flagString(args.flags, "upstream"));
  const quiet = args.flags.quiet === true;
  const proxy = await startProxy({
    port,
    upstream,
    enabled: args.flags.off !== true,
    onEvent: quiet ? undefined : (e) => process.stderr.write(`${eventLine(e, color)}\n`),
  });
  process.stderr.write(
    `${p.magenta("deja")} listening on ${p.bold(proxy.url)} → ${upstream}\n` +
      p.dim(`point your agent at it:  export ANTHROPIC_BASE_URL=${proxy.url}\n`),
  );
  await new Promise<void>((resolve) => {
    const stop = () => proxy.server.close(() => resolve());
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

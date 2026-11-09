import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { transformRequest, type TransformOptions, type TransformStats } from "../anthropic/transform.js";
import { isMessagesRequest } from "../anthropic/types.js";
import { takeInventory } from "../decay/inventory.js";
import { decide, DEFAULT_DECAY, type DecayConfig, type DecayReason } from "../decay/policy.js";
import type { StateStore } from "../decay/store.js";

export const DEFAULT_UPSTREAM = "https://api.anthropic.com";

export interface ProxyEvent {
  path: string;
  model?: string;
  stats: TransformStats;
  /** Milliseconds spent transforming the request. */
  ms: number;
  /** What the decay policy did, when decay is enabled. */
  decay?: { reason: DecayReason; newlyEvicted: number; evicted: number };
}

export interface DecayOptions {
  store: StateStore;
  config?: DecayConfig;
  /** Injected clock, for tests. */
  now?: () => number;
}

export interface ProxyOptions {
  upstream?: string;
  transform?: TransformOptions;
  /** Called once per transformed Messages request. Never receives content. */
  onRequest?: (event: ProxyEvent) => void;
  /** When false, requests are forwarded untouched (useful for A/B checks). */
  enabled?: boolean;
  /** Cache-aware eviction of stale context. Omit to run dedup only. */
  decay?: DecayOptions;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

/** Endpoints whose bodies carry a conversation worth compressing. */
export function isCompressiblePath(path: string): boolean {
  const p = path.split("?")[0] ?? "";
  return /\/v1\/messages(\/count_tokens)?$/.test(p);
}

export function forwardHeaders(headers: IncomingHttpHeaders, bodyLength: number | null): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP_BY_HOP.has(k)) continue;
    if (k === "content-length") continue;
    out[k] = v;
  }
  if (bodyLength !== null) out["content-length"] = String(bodyLength);
  return out;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Rewrite a request body if it is an uncompressed JSON Messages request.
 * Anything we do not understand is returned unchanged, byte for byte.
 */
export function rewriteBody(
  path: string,
  headers: IncomingHttpHeaders,
  body: Buffer,
  opts: ProxyOptions,
): { body: Buffer; event?: ProxyEvent } {
  if (opts.enabled === false || !isCompressiblePath(path) || body.length === 0) return { body };
  if (headers["content-encoding"]) return { body };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return { body };
  }
  if (!isMessagesRequest(parsed)) return { body };
  const started = performance.now();
  let evict: Set<string> | undefined;
  let decayInfo: ProxyEvent["decay"];
  if (opts.decay) {
    const key = takeInventory(parsed).key;
    if (key) {
      const isCount = path.split("?")[0]!.endsWith("/count_tokens");
      if (isCount) {
        // Token counting must reflect what we would send, but is not a turn.
        evict = new Set(opts.decay.store.peek(key)?.evicted ?? []);
      } else {
        const state = opts.decay.store.get(key);
        const d = decide(parsed, state, (opts.decay.now ?? Date.now)(), opts.decay.config ?? DEFAULT_DECAY);
        evict = d.evict;
        decayInfo = { reason: d.reason, newlyEvicted: d.newlyEvicted.length, evicted: d.evict.size };
        try {
          opts.decay.store.save();
        } catch {
          // Losing persistence costs a cache rebuild later, not correctness.
        }
      }
    }
  }
  const result = transformRequest(parsed, { ...opts.transform, evict });
  const event: ProxyEvent = {
    path,
    model: parsed.model,
    stats: result.stats,
    ms: performance.now() - started,
    decay: decayInfo,
  };
  if (!result.changed) return { body, event };
  return { body: Buffer.from(JSON.stringify(result.body), "utf8"), event };
}

function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify({ type: "error", error: { type: "api_error", message: `deja proxy: ${message}` } });
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

export function createProxy(opts: ProxyOptions = {}): Server {
  const upstream = new URL(opts.upstream ?? DEFAULT_UPSTREAM);
  const send = upstream.protocol === "http:" ? httpRequest : httpsRequest;
  const basePath = upstream.pathname.replace(/\/$/, "");

  return createServer(async (req, res) => {
    const path = req.url ?? "/";
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (err) {
      sendError(res, 400, `could not read request: ${(err as Error).message}`);
      return;
    }

    let rewritten: ReturnType<typeof rewriteBody>;
    try {
      rewritten = rewriteBody(path, req.headers, body, opts);
    } catch {
      // Compression must never break a request: fall back to the original.
      rewritten = { body };
    }
    if (rewritten.event) {
      try {
        opts.onRequest?.(rewritten.event);
      } catch {
        // Accounting failures are not the user's problem.
      }
    }

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const upstreamReq = send(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || undefined,
        method: req.method,
        path: `${basePath}${path}`,
        headers: { ...forwardHeaders(req.headers, hasBody ? rewritten.body.length : null), host: upstream.host },
      },
      (upstreamRes) => {
        const headers: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(upstreamRes.headers)) {
          if (v !== undefined && !HOP_BY_HOP.has(k)) headers[k] = v;
        }
        res.writeHead(upstreamRes.statusCode ?? 502, headers);
        upstreamRes.pipe(res);
      },
    );
    upstreamReq.on("error", (err) => sendError(res, 502, `upstream error: ${err.message}`));
    res.on("close", () => {
      if (!res.writableFinished) upstreamReq.destroy();
    });
    if (hasBody) upstreamReq.end(rewritten.body);
    else upstreamReq.end();
  });
}

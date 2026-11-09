import {
  Agent as HttpAgent,
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { transformRequest, type TransformOptions, type TransformStats } from "../anthropic/transform.js";
import { isMessagesRequest, type MessagesRequest } from "../anthropic/types.js";
import { fromAnthropic, toAnthropic } from "../openai/adapter.js";
import { isResponsesRequest, responsesFromAnthropic, responsesToAnthropic } from "../openai/responses.js";
import { isChatRequest } from "../openai/types.js";
import { estimateTokens } from "../core/tokens.js";
import { messageTokens, takeInventory } from "../decay/inventory.js";
import { decide, DEFAULT_DECAY, type DecayConfig, type DecayReason } from "../decay/policy.js";
import type { StateStore } from "../decay/store.js";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { UsageSniffer, type Usage } from "./usage.js";

export const DEFAULT_UPSTREAM = "https://api.anthropic.com";

export interface ProxyEvent {
  path: string;
  model?: string;
  stats: TransformStats;
  /** Milliseconds spent transforming the request. */
  ms: number;
  /** What the decay policy did, when decay is enabled. */
  decay?: { reason: DecayReason; newlyEvicted: number; evicted: number };
  /** Token usage reported by the provider for this request, when available. */
  usage?: Usage;
  /**
   * deja's own estimate of the prompt tokens actually sent (system, tools
   * and messages after rewriting). Compared with `usage` it measures how
   * accurate the estimator is on real traffic.
   */
  estimatedPrompt?: number;
  /** HTTP status returned by the upstream. */
  status?: number;
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
  /** Extra fields for the local `GET /deja/health` endpoint. */
  status?: () => Record<string, unknown>;
}

/** Local endpoint answered by deja itself, never forwarded. */
export const HEALTH_PATH = "/deja/health";

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

export type ApiKind = "anthropic" | "openai" | "responses";

/** Which API a path belongs to, if its body carries a conversation. */
export function apiKind(path: string): ApiKind | undefined {
  const p = path.split("?")[0] ?? "";
  if (/\/v1\/messages(\/count_tokens)?$/.test(p)) return "anthropic";
  if (/\/chat\/completions$/.test(p)) return "openai";
  if (/\/v1\/responses$/.test(p)) return "responses";
  return undefined;
}

/** Endpoints whose bodies carry a conversation worth compressing. */
export function isCompressiblePath(path: string): boolean {
  return apiKind(path) !== undefined;
}

/** OpenAI-style caches have no write premium: a rewrite costs 1x, not 1.25x. */
export const OPENAI_CACHE = { writeMultiplier: 1, readMultiplier: 0.1 };

/** Request header that turns deja off for one request: `x-deja: off`. */
export const BYPASS_HEADER = "x-deja";

export function isBypassed(headers: IncomingHttpHeaders): boolean {
  const v = headers[BYPASS_HEADER];
  const s = Array.isArray(v) ? v[0] : v;
  return s !== undefined && /^(off|0|false|bypass)$/i.test(s.trim());
}

export function forwardHeaders(headers: IncomingHttpHeaders, bodyLength: number | null): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP_BY_HOP.has(k) || k === BYPASS_HEADER) continue;
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
 * Rewrite a request body if it is an uncompressed JSON Anthropic Messages or
 * OpenAI Chat Completions request.
 * Anything we do not understand is returned unchanged, byte for byte.
 */
export function rewriteBody(
  path: string,
  headers: IncomingHttpHeaders,
  body: Buffer,
  opts: ProxyOptions,
): { body: Buffer; event?: ProxyEvent } {
  const kind = apiKind(path);
  if (opts.enabled === false || !kind || body.length === 0 || isBypassed(headers)) return { body };
  if (headers["content-encoding"]) return { body };
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    return { body };
  }
  const started = performance.now();
  // Map every supported API onto the engine's Anthropic shape, and keep a
  // way back to the original format for the rewritten result.
  let parsed: MessagesRequest;
  let back: (out: MessagesRequest, changed: boolean) => unknown;
  if (kind === "openai") {
    if (!isChatRequest(raw)) return { body };
    const chat = raw;
    const mapped = toAnthropic(chat);
    parsed = mapped.body;
    back = (out, changed) => (changed ? fromAnthropic(chat, mapped, out) : chat);
  } else if (kind === "responses") {
    if (!isResponsesRequest(raw)) return { body };
    const req = raw;
    const mapped = responsesToAnthropic(req);
    parsed = mapped.body;
    back = (out, changed) => (changed ? responsesFromAnthropic(req, mapped, out) : req);
  } else {
    if (!isMessagesRequest(raw)) return { body };
    parsed = raw;
    back = (out) => out;
  }
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
        const base = opts.decay.config ?? DEFAULT_DECAY;
        const cfg = kind === "anthropic" ? base : { ...base, ...OPENAI_CACHE };
        const d = decide(parsed, state, (opts.decay.now ?? Date.now)(), cfg);
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
  const out = back(result.body, result.changed);
  const event: ProxyEvent = {
    path,
    model: parsed.model,
    stats: result.stats,
    ms: performance.now() - started,
    decay: decayInfo,
    estimatedPrompt: estimatePrompt(result.body),
  };
  if (!result.changed) return { body, event };
  return { body: Buffer.from(JSON.stringify(out), "utf8"), event };
}

/** Estimated prompt tokens of a request: system, tool definitions, messages. */
export function estimatePrompt(body: MessagesRequest): number {
  let n = 0;
  const system = body.system;
  if (typeof system === "string") n += estimateTokens(system);
  else if (Array.isArray(system)) for (const b of system) n += estimateTokens(String(b.text ?? ""));
  if (Array.isArray(body.tools)) n += estimateTokens(JSON.stringify(body.tools));
  for (const m of body.messages) n += messageTokens(m);
  return n;
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

function decoded(stream: Readable, encoding: string | string[] | undefined): Readable {
  const enc = Array.isArray(encoding) ? encoding[0] : encoding;
  switch (enc?.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return stream.pipe(createGunzip());
    case "br":
      return stream.pipe(createBrotliDecompress());
    case "deflate":
      return stream.pipe(createInflate());
    default:
      return stream;
  }
}

export function createProxy(opts: ProxyOptions = {}): Server {
  const upstream = new URL(opts.upstream ?? DEFAULT_UPSTREAM);
  const send = upstream.protocol === "http:" ? httpRequest : httpsRequest;
  // Reuse upstream connections: agents make many requests in a row, and a
  // fresh TLS handshake for each would add latency to every turn.
  const agent = upstream.protocol === "http:" ? new HttpAgent({ keepAlive: true }) : new HttpsAgent({ keepAlive: true });
  const basePath = upstream.pathname.replace(/\/$/, "");

  const server = createServer(async (req, res) => {
    const path = req.url ?? "/";
    if (req.method === "GET" && path.split("?")[0] === HEALTH_PATH) {
      let extra: Record<string, unknown> = {};
      try {
        extra = opts.status?.() ?? {};
      } catch {
        // A broken status callback must not take the endpoint down.
      }
      const body = JSON.stringify({ ok: true, upstream: upstream.href, ...extra });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
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
    let reported = false;
    const report = (extra: Partial<ProxyEvent> = {}) => {
      if (reported || !rewritten.event) return;
      reported = true;
      try {
        opts.onRequest?.({ ...rewritten.event, ...extra });
      } catch {
        // Accounting failures are not the user's problem.
      }
    };

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const upstreamReq = send(
      {
        protocol: upstream.protocol,
        agent,
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
        const status = upstreamRes.statusCode ?? 502;
        res.writeHead(status, headers);
        upstreamRes.pipe(res);
        if (!rewritten.event) return;
        // Watch a (decoded) copy of the response for usage; the client gets
        // the original bytes untouched.
        const sniffer = new UsageSniffer();
        const copy = decoded(upstreamRes, upstreamRes.headers["content-encoding"]);
        copy.setEncoding("utf8");
        copy.on("data", (chunk: string) => sniffer.feed(chunk));
        copy.on("error", () => report({ status }));
        copy.on("end", () => report({ status, usage: sniffer.finish() }));
        upstreamRes.on("aborted", () => report({ status }));
      },
    );
    upstreamReq.on("error", (err) => {
      report();
      sendError(res, 502, `upstream error: ${err.message}`);
    });
    res.on("close", () => {
      if (!res.writableFinished) upstreamReq.destroy();
    });
    if (hasBody) upstreamReq.end(rewritten.body);
    else upstreamReq.end();
  });
  server.on("close", () => agent.destroy());
  return server;
}

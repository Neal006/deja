import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { transformRequest, type TransformOptions, type TransformStats } from "../anthropic/transform.js";
import { isMessagesRequest } from "../anthropic/types.js";

export const DEFAULT_UPSTREAM = "https://api.anthropic.com";

export interface ProxyEvent {
  path: string;
  model?: string;
  stats: TransformStats;
  /** Milliseconds spent transforming the request. */
  ms: number;
}

export interface ProxyOptions {
  upstream?: string;
  transform?: TransformOptions;
  /** Called once per transformed Messages request. Never receives content. */
  onRequest?: (event: ProxyEvent) => void;
  /** When false, requests are forwarded untouched (useful for A/B checks). */
  enabled?: boolean;
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
  const result = transformRequest(parsed, opts.transform);
  const event: ProxyEvent = {
    path,
    model: parsed.model,
    stats: result.stats,
    ms: performance.now() - started,
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

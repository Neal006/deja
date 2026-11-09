import type { IncomingHttpHeaders } from "node:http";
import type { DecayConfig } from "./decay/policy.js";
import { StateStore } from "./decay/store.js";
import { rewriteBody, type ProxyEvent } from "./proxy/server.js";

/**
 * In-process deja for agents you build yourself. Pass the result as the
 * `fetch` option of the Anthropic or OpenAI SDK:
 *
 *   import Anthropic from "@anthropic-ai/sdk";
 *   import { dejaFetch } from "dejactx";
 *   const client = new Anthropic({ fetch: dejaFetch() });
 *
 * Requests to the Messages, Chat Completions and Responses endpoints are
 * rewritten exactly as the proxy would; everything else is passed through.
 */

export interface DejaFetchOptions {
  /** The fetch to wrap (default: global fetch). */
  fetch?: typeof fetch;
  /** Set false for dedup only. */
  decay?: boolean;
  decayConfig?: DecayConfig;
  /** Where to persist decay state; omit to keep it in memory. */
  statePath?: string;
  /** Observe what deja did to each request. */
  onRequest?: (event: ProxyEvent) => void;
}

function bodyBuffer(body: unknown): Buffer | undefined {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return undefined;
}

export function dejaFetch(options: DejaFetchOptions = {}): typeof fetch {
  const inner = options.fetch ?? globalThis.fetch;
  const store = new StateStore(options.statePath);
  const decay = options.decay === false ? undefined : { store, config: options.decayConfig };

  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = bodyBuffer(init?.body);
    if (!raw || (init?.method ?? "GET").toUpperCase() !== "POST") return inner(input, init);

    let path: string;
    try {
      const u = new URL(url);
      path = u.pathname + u.search;
    } catch {
      return inner(input, init);
    }
    const headers: IncomingHttpHeaders = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    let out: ReturnType<typeof rewriteBody>;
    try {
      out = rewriteBody(path, headers, raw, { decay });
    } catch {
      return inner(input, init);
    }
    if (out.event) options.onRequest?.(out.event);
    if (out.body === raw) return inner(input, init);
    const h = new Headers(init?.headers);
    h.delete("content-length");
    return inner(input, { ...init, headers: h, body: out.body.toString("utf8") });
  };
}

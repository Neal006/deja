import { describe, expect, it } from "vitest";
import { dejaFetch } from "../src/fetch.js";
import * as lib from "../src/index.js";
import type { ProxyEvent } from "../src/proxy/server.js";
import { code, Conversation, numbered } from "./helpers/conversation.js";

function recordingFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}

const body = () => {
  const file = numbered(code(60));
  return JSON.stringify(new Conversation().tool("Read", { file_path: "/repo/a.ts" }, file).tool("Read", { file_path: "/repo/a.ts" }, file).build());
};

describe("dejaFetch", () => {
  it("rewrites Messages API requests", async () => {
    const { f, calls } = recordingFetch();
    const events: ProxyEvent[] = [];
    const df = dejaFetch({ fetch: f, onRequest: (e) => events.push(e) });
    const raw = body();
    await df("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(raw.length) },
      body: raw,
    });
    const sent = calls[0]!.init!.body as string;
    expect(sent).toContain("same as all of Read a.ts");
    expect(sent.length).toBeLessThan(raw.length);
    expect(new Headers(calls[0]!.init!.headers).get("content-length")).toBeNull();
    expect(events[0]!.stats.compressed).toBe(1);
  });

  it("passes non-POST and unrelated requests through untouched", async () => {
    const { f, calls } = recordingFetch();
    const df = dejaFetch({ fetch: f });
    await df("https://api.anthropic.com/v1/models");
    const raw = body();
    await df("https://example.com/upload", { method: "POST", body: raw });
    expect(calls[0]!.init).toBeUndefined();
    expect(calls[1]!.init!.body).toBe(raw);
  });

  it("accepts byte bodies", async () => {
    const { f, calls } = recordingFetch();
    await dejaFetch({ fetch: f })("https://api.anthropic.com/v1/messages", { method: "POST", body: new TextEncoder().encode(body()) });
    expect(String(calls[0]!.init!.body)).toContain("same as all of Read a.ts");
  });

  it("can run dedup only", async () => {
    const { f, calls } = recordingFetch();
    await dejaFetch({ fetch: f, decay: false })("https://api.anthropic.com/v1/messages", { method: "POST", body: body() });
    expect(String(calls[0]!.init!.body)).toContain("same as all of Read a.ts");
  });
});

describe("library entry point", () => {
  it("exports the public API", () => {
    for (const name of ["dejaFetch", "createProxy", "transformRequest", "transformChatRequest", "transformResponsesRequest", "decide", "CacheBiller", "replayAll", "estimateTokens"]) {
      expect(typeof (lib as Record<string, unknown>)[name]).toBe("function");
    }
  });
});

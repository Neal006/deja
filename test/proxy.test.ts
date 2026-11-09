import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "../src/decay/store.js";
import { apiKind, createProxy, estimatePrompt, forwardHeaders, isCompressiblePath, rewriteBody, type ProxyEvent } from "../src/proxy/server.js";
import { code, Conversation, numbered } from "./helpers/conversation.js";

interface Captured {
  method?: string;
  url?: string;
  headers?: IncomingHttpHeaders;
  body?: string;
}

const servers: Server[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

async function fakeUpstream(captured: Captured, reply = '{"ok":true}', status = 200): Promise<number> {
  return listen(
    createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        captured.method = req.method;
        captured.url = req.url;
        captured.headers = req.headers;
        captured.body = Buffer.concat(chunks).toString("utf8");
        res.writeHead(status, { "content-type": "application/json", "x-upstream": "yes" });
        res.end(reply);
      });
    }),
  );
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function repeatedReads() {
  const file = numbered(code(60));
  return new Conversation()
    .tool("Read", { file_path: "/repo/a.ts" }, file)
    .tool("Read", { file_path: "/repo/a.ts" }, file)
    .build();
}

describe("apiKind", () => {
  it.each([
    ["/v1/messages", "anthropic"],
    ["/v1/chat/completions", "openai"],
    ["/api/v1/chat/completions?x=1", "openai"],
    ["/v1/responses", "responses"],
    ["/v1/embeddings", undefined],
  ])("%s -> %s", (p, k) => expect(apiKind(p)).toBe(k));
});

describe("rewriteBody for OpenAI", () => {
  function chat() {
    const file = numbered(code(60));
    const msgs = [
      { role: "system", content: "sys" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] },
      { role: "tool", tool_call_id: "c1", content: file },
      { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] },
      { role: "tool", tool_call_id: "c2", content: file },
    ];
    return Buffer.from(JSON.stringify({ model: "gpt-5", messages: msgs }));
  }

  it("dedups chat completions and keeps the OpenAI shape", () => {
    const r = rewriteBody("/v1/chat/completions", {}, chat(), {});
    const out = JSON.parse(r.body.toString()) as { messages: Array<{ role: string; content: string }> };
    expect(out.messages).toHaveLength(5);
    expect(out.messages[4]!.role).toBe("tool");
    expect(out.messages[4]!.content).toContain("same as all of read_file a.ts");
    expect(r.event?.stats.compressed).toBe(1);
  });

  it("leaves Anthropic-shaped bodies on the chat path alone", () => {
    const raw = Buffer.from(JSON.stringify({ messages: [{ role: "user", content: "hi" }] }));
    expect(rewriteBody("/v1/chat/completions", {}, raw, {}).body).toBe(raw);
  });
});

describe("rewriteBody for the Responses API", () => {
  it("dedups function call outputs", () => {
    const file = numbered(code(60));
    const input = [
      { type: "function_call", call_id: "c1", name: "read_file", arguments: '{"path":"a.ts"}' },
      { type: "function_call_output", call_id: "c1", output: file },
      { type: "function_call", call_id: "c2", name: "read_file", arguments: '{"path":"a.ts"}' },
      { type: "function_call_output", call_id: "c2", output: file },
    ];
    const r = rewriteBody("/v1/responses", {}, Buffer.from(JSON.stringify({ model: "gpt-5", input })), {});
    const out = JSON.parse(r.body.toString()) as { input: Array<{ output?: string }> };
    expect(out.input).toHaveLength(4);
    expect(out.input[3]!.output).toContain("same as all of read_file a.ts");
  });
});

describe("isCompressiblePath", () => {
  it.each([
    ["/v1/messages", true],
    ["/v1/messages?beta=true", true],
    ["/v1/messages/count_tokens", true],
    ["/v1/models", false],
    ["/v1/messages/batches", false],
  ])("%s -> %s", (p, expected) => expect(isCompressiblePath(p)).toBe(expected));
});

describe("forwardHeaders", () => {
  it("drops hop-by-hop headers and rewrites content-length", () => {
    const h = forwardHeaders({ host: "x", connection: "keep-alive", "content-length": "5", "x-api-key": "k" }, 10);
    expect(h).toEqual({ "x-api-key": "k", "content-length": "10" });
  });
});

describe("rewriteBody", () => {
  it("compresses messages requests", () => {
    const raw = Buffer.from(JSON.stringify(repeatedReads()));
    const r = rewriteBody("/v1/messages", {}, raw, {});
    expect(r.body.length).toBeLessThan(raw.length);
    expect(r.event?.stats.compressed).toBe(1);
  });

  it("passes non-JSON through byte for byte", () => {
    const raw = Buffer.from("not json");
    expect(rewriteBody("/v1/messages", {}, raw, {}).body).toBe(raw);
  });

  it("passes encoded bodies through", () => {
    const raw = Buffer.from(JSON.stringify(repeatedReads()));
    expect(rewriteBody("/v1/messages", { "content-encoding": "gzip" }, raw, {}).body).toBe(raw);
  });

  it("passes everything through when disabled", () => {
    const raw = Buffer.from(JSON.stringify(repeatedReads()));
    expect(rewriteBody("/v1/messages", {}, raw, { enabled: false }).body).toBe(raw);
  });

  it("keeps the original bytes when nothing changed", () => {
    const raw = Buffer.from(JSON.stringify(new Conversation().user("hi").build()));
    const r = rewriteBody("/v1/messages", {}, raw, {});
    expect(r.body).toBe(raw);
    expect(r.event).toBeDefined();
  });
});

describe("estimatePrompt", () => {
  it("counts system, tools and messages", () => {
    const body = new Conversation("x".repeat(400)).user("y".repeat(400)).build();
    const bare = estimatePrompt(body);
    expect(bare).toBeGreaterThanOrEqual(200);
    expect(estimatePrompt({ ...body, tools: [{ name: "Read", description: "z".repeat(400) }] })).toBeGreaterThan(bare + 90);
  });

  it("is attached to proxy events", () => {
    const r = rewriteBody("/v1/messages", {}, Buffer.from(JSON.stringify(repeatedReads())), {});
    expect(r.event?.estimatedPrompt).toBeGreaterThan(0);
  });
});

describe("rewriteBody with decay", () => {
  const log = Array.from({ length: 200 }, (_, i) => `PASS test/suite-${i}.test.ts (${i} ms) fine`).join("\n");
  function aged(turns: number) {
    const c = new Conversation().tool("Bash", { command: "npm test" }, log);
    for (let i = 0; i < turns; i++) c.tool("Bash", { command: `echo ${i}` }, "ok");
    return Buffer.from(JSON.stringify(c.build()));
  }

  it("evicts stale output and reports it", () => {
    const store = new StateStore();
    const r = rewriteBody("/v1/messages", {}, aged(6), { decay: { store, now: () => 0 } });
    expect(r.event?.decay).toEqual({ reason: "idle", newlyEvicted: 1, evicted: 1 });
    expect(r.body.toString()).toContain("deja: stale output of Bash `npm test`");
    expect(store.peek("toolu_0001")?.evicted).toEqual(["toolu_0001"]);
  });

  it("applies but does not advance decay for count_tokens", () => {
    const store = new StateStore();
    store.get("toolu_0001").evicted = ["toolu_0001"];
    const r = rewriteBody("/v1/messages/count_tokens", {}, aged(1), { decay: { store, now: () => 0 } });
    expect(r.event?.decay).toBeUndefined();
    expect(r.body.toString()).toContain("deja: stale output");
    expect(store.peek("toolu_0001")?.lastSeen).toBeUndefined();
  });

  it("does nothing to young conversations", () => {
    const store = new StateStore();
    const r = rewriteBody("/v1/messages", {}, aged(1), { decay: { store, now: () => 0 } });
    expect(r.event?.decay?.reason).toBe("none");
  });
});

describe("createProxy", () => {
  it("forwards a compressed body and relays the response", async () => {
    const captured: Captured = {};
    const upstreamPort = await fakeUpstream(captured);
    const events: ProxyEvent[] = [];
    const port = await listen(createProxy({ upstream: `http://127.0.0.1:${upstreamPort}`, onRequest: (e) => events.push(e) }));

    const body = JSON.stringify(repeatedReads());
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "sk-test", "anthropic-version": "2023-06-01" },
      body,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-upstream")).toBe("yes");
    expect(await res.json()).toEqual({ ok: true });
    expect(captured.url).toBe("/v1/messages");
    expect(captured.headers?.["x-api-key"]).toBe("sk-test");
    expect(captured.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect(captured.body!.length).toBeLessThan(body.length);
    expect(captured.body).toContain("same as all of Read a.ts");
    expect(Number(captured.headers?.["content-length"])).toBe(Buffer.byteLength(captured.body!));
    expect(events).toHaveLength(1);
  });

  it("forwards other endpoints untouched", async () => {
    const captured: Captured = {};
    const upstreamPort = await fakeUpstream(captured);
    const port = await listen(createProxy({ upstream: `http://127.0.0.1:${upstreamPort}` }));
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    expect(res.status).toBe(200);
    expect(captured.method).toBe("GET");
    expect(captured.url).toBe("/v1/models");
  });

  it("respects an upstream base path", async () => {
    const captured: Captured = {};
    const upstreamPort = await fakeUpstream(captured);
    const port = await listen(createProxy({ upstream: `http://127.0.0.1:${upstreamPort}/gateway/` }));
    await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: "{}" });
    expect(captured.url).toBe("/gateway/v1/messages");
  });

  it("relays upstream error statuses", async () => {
    const captured: Captured = {};
    const upstreamPort = await fakeUpstream(captured, '{"type":"error"}', 429);
    const port = await listen(createProxy({ upstream: `http://127.0.0.1:${upstreamPort}` }));
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: "{}" });
    expect(res.status).toBe(429);
  });

  it("returns a 502 in Anthropic error format when upstream is down", async () => {
    const port = await listen(createProxy({ upstream: "http://127.0.0.1:1" }));
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: "{}" });
    expect(res.status).toBe(502);
    const json = (await res.json()) as { type: string; error: { message: string } };
    expect(json.type).toBe("error");
    expect(json.error.message).toMatch(/deja proxy/);
  });

  it("streams chunked upstream responses", async () => {
    const port0 = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("event: a\ndata: 1\n\n");
        setTimeout(() => res.end("event: b\ndata: 2\n\n"), 20);
      }),
    );
    const port = await listen(createProxy({ upstream: `http://127.0.0.1:${port0}` }));
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: "{}" });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n");
  });

  it("reports provider usage from a streamed response", async () => {
    const sse =
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3,"cache_read_input_tokens":800,"cache_creation_input_tokens":40,"output_tokens":1}}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":9}}\n\n';
    const port0 = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sse);
      }),
    );
    const events: ProxyEvent[] = [];
    const port = await listen(createProxy({ upstream: `http://127.0.0.1:${port0}`, onRequest: (e) => events.push(e) }));
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: JSON.stringify(repeatedReads()) });
    expect(await res.text()).toBe(sse);
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toHaveLength(1);
    expect(events[0]!.usage).toEqual({ input: 3, cacheRead: 800, cacheWrite: 40, output: 9 });
    expect(events[0]!.status).toBe(200);
  });

  it("decodes gzip responses for usage but relays the original bytes", async () => {
    const json = '{"id":"m","usage":{"input_tokens":4,"output_tokens":2}}';
    const gz = gzipSync(json);
    const port0 = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
        res.end(gz);
      }),
    );
    const events: ProxyEvent[] = [];
    const port = await listen(createProxy({ upstream: `http://127.0.0.1:${port0}`, onRequest: (e) => events.push(e) }));
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: "{\"messages\":[]}" });
    // fetch transparently gunzips, proving the proxy relayed valid gzip.
    expect(await res.text()).toBe(json);
    await new Promise((r) => setTimeout(r, 20));
    expect(events[0]!.usage).toEqual({ input: 4, cacheRead: 0, cacheWrite: 0, output: 2 });
  });

  it("still reports the event when the upstream is unreachable", async () => {
    const events: ProxyEvent[] = [];
    const port = await listen(createProxy({ upstream: "http://127.0.0.1:1", onRequest: (e) => events.push(e) }));
    await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", body: "{\"messages\":[]}" });
    expect(events).toHaveLength(1);
    expect(events[0]!.usage).toBeUndefined();
  });
});

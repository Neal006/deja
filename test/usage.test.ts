import { describe, expect, it } from "vitest";
import { UsageSniffer } from "../src/proxy/usage.js";

const sse = [
  "event: message_start",
  'data: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":12,"cache_creation_input_tokens":300,"cache_read_input_tokens":9000,"output_tokens":1}}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
  "",
  "event: message_delta",
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}',
  "",
].join("\n");

describe("UsageSniffer", () => {
  it("reads usage from an SSE stream", () => {
    const s = new UsageSniffer();
    s.feed(sse);
    expect(s.finish()).toEqual({ input: 12, cacheRead: 9000, cacheWrite: 300, output: 42 });
  });

  it("handles chunks split mid-line", () => {
    const s = new UsageSniffer();
    for (let i = 0; i < sse.length; i += 7) s.feed(sse.slice(i, i + 7));
    expect(s.finish()).toEqual({ input: 12, cacheRead: 9000, cacheWrite: 300, output: 42 });
  });

  it("reads usage from a JSON response", () => {
    const s = new UsageSniffer();
    s.feed('{"id":"m","content":[],"usage":{"input_tokens":5,');
    s.feed('"cache_read_input_tokens":7,"output_tokens":3}}');
    expect(s.finish()).toEqual({ input: 5, cacheRead: 7, cacheWrite: 0, output: 3 });
  });

  it("returns undefined without usage", () => {
    const s = new UsageSniffer();
    s.feed('{"type":"error","error":{}}');
    expect(s.finish()).toBeUndefined();
  });

  it("ignores malformed data lines", () => {
    const s = new UsageSniffer();
    s.feed('event: x\ndata: {"usage": nope}\n');
    expect(s.finish()).toBeUndefined();
  });

  it("reads OpenAI-style usage from the final stream chunk", () => {
    const s = new UsageSniffer();
    s.feed('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    s.feed('data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":900}}}\n\n');
    s.feed("data: [DONE]\n\n");
    expect(s.finish()).toEqual({ input: 100, cacheRead: 900, cacheWrite: 0, output: 20 });
  });

  it("reads OpenAI-style usage from a JSON response", () => {
    const s = new UsageSniffer();
    s.feed('{"id":"c","usage":{"prompt_tokens":50,"completion_tokens":5}}');
    expect(s.finish()).toEqual({ input: 50, cacheRead: 0, cacheWrite: 0, output: 5 });
  });
});

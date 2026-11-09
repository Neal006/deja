import { describe, expect, it } from "vitest";
import { addBill, emptyBill, replayAll, replaySegment } from "../src/audit/replay.js";
import type { Segment } from "../src/audit/transcript.js";
import type { Message } from "../src/anthropic/types.js";
import { code, Conversation, numbered } from "./helpers/conversation.js";

const MIN = 60_000;
const log = Array.from({ length: 300 }, (_, i) => `PASS test/suite-${i}.test.ts (${i} ms) everything fine`).join("\n");

/** A session where each tool round trip is followed by an assistant turn. */
function session(rounds: number, gapMs = MIN): Segment {
  const conv = new Conversation().user("start");
  conv.tool("Bash", { command: "npm test" }, log);
  conv.tool("Read", { file_path: "/repo/a.ts" }, numbered(code(80)));
  for (let i = 0; i < rounds; i++) conv.tool("Bash", { command: `echo ${i}` }, `ok ${i}`);
  const messages: Message[] = conv.build().messages;
  messages.push({ role: "assistant", content: [{ type: "text", text: "done" }] });
  const times = messages.map((_, i) => i * gapMs);
  return { messages, times };
}

describe("replaySegment", () => {
  it("bills one request per assistant message", () => {
    const seg = session(3);
    const bill = replaySegment(seg, "baseline");
    expect(bill.requests).toBe(seg.messages.filter((m) => m.role === "assistant").length);
  });

  it("makes deja cheaper than baseline on a long session", () => {
    const r = replayAll(session(40));
    expect(r.deja!.cost).toBeLessThan(r.baseline!.cost);
    expect(r.deja!.promptTokens).toBeLessThan(r.baseline!.promptTokens);
  });

  it("never makes dedup alone more expensive than baseline", () => {
    const r = replayAll(session(20));
    expect(r.dedup!.cost).toBeLessThanOrEqual(r.baseline!.cost + 1e-6);
  });

  it("shows eager pruning losing to deja when the cache stays warm", () => {
    // Short gaps keep the cache warm, so every eager prune is a costly rewrite.
    const r = replayAll(session(40, 1000));
    expect(r.deja!.cost).toBeLessThanOrEqual(r.eager!.cost);
  });

  it("handles a segment without assistant turns", () => {
    const bill = replaySegment({ messages: [{ role: "user", content: "hi" }], times: [0] }, "deja");
    expect(bill.requests).toBe(0);
  });
});

describe("bill helpers", () => {
  it("adds bills", () => {
    const a = { cost: 1, cachedTokens: 2, writtenTokens: 3, promptTokens: 5, requests: 1 };
    expect(addBill(a, a)).toEqual({ cost: 2, cachedTokens: 4, writtenTokens: 6, promptTokens: 10, requests: 2 });
    expect(addBill(emptyBill(), a)).toEqual(a);
  });
});

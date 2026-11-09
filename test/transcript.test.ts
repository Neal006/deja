import { describe, expect, it } from "vitest";
import { parseTranscript, resendCounts } from "../src/audit/transcript.js";
import type { ContentBlock } from "../src/anthropic/types.js";

const L = (o: object) => JSON.stringify(o);

function sample(): string {
  return [
    L({ type: "permission-mode", sessionId: "s1" }),
    L({ type: "user", sessionId: "s1", cwd: "/repo", timestamp: "2026-11-01T10:00:00Z", message: { role: "user", content: "fix it" } }),
    L({ type: "assistant", timestamp: "2026-11-01T10:00:05Z", message: { id: "m1", role: "assistant", content: [{ type: "thinking", thinking: "" }] } }),
    L({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/a" } }] } }),
    L({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] } }),
    L({ type: "assistant", message: { id: "m2", role: "assistant", content: [{ type: "text", text: "done" }] } }),
    "not json at all",
    L({ type: "assistant", isSidechain: true, message: { id: "m9", role: "assistant", content: [{ type: "text", text: "side" }] } }),
  ].join("\n");
}

describe("parseTranscript", () => {
  it("merges split assistant lines sharing a message id", () => {
    const t = parseTranscript(sample());
    expect(t.segments).toHaveLength(1);
    const msgs = t.segments[0]!.messages;
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect((msgs[1]!.content as ContentBlock[]).map((b) => b.type)).toEqual(["thinking", "tool_use"]);
  });

  it("captures metadata", () => {
    const t = parseTranscript(sample(), "/p.jsonl");
    expect(t.sessionId).toBe("s1");
    expect(t.cwd).toBe("/repo");
    expect(t.path).toBe("/p.jsonl");
    expect(t.start).toBe(Date.parse("2026-11-01T10:00:00Z"));
    expect(t.end).toBe(Date.parse("2026-11-01T10:00:05Z"));
  });

  it("finds the most used model", () => {
    const text = [
      L({ type: "assistant", message: { id: "1", role: "assistant", model: "claude-opus-4-5", content: "a" } }),
      L({ type: "assistant", message: { id: "2", role: "assistant", model: "claude-opus-4-5", content: "b" } }),
      L({ type: "assistant", message: { id: "3", role: "assistant", model: "claude-haiku-4-5", content: "c" } }),
      L({ type: "assistant", message: { id: "4", role: "assistant", model: "<synthetic>", content: "d" } }),
    ].join("\n");
    expect(parseTranscript(text).model).toBe("claude-opus-4-5");
  });

  it("records a timestamp per message", () => {
    const seg = parseTranscript(sample()).segments[0]!;
    expect(seg.times).toHaveLength(seg.messages.length);
    expect(seg.times[0]).toBe(Date.parse("2026-11-01T10:00:00Z"));
    expect(seg.times[2]).toBeUndefined();
  });

  it("starts a new segment at a compact boundary", () => {
    const text = [
      L({ type: "user", message: { role: "user", content: "a" } }),
      L({ type: "system", subtype: "compact_boundary" }),
      L({ type: "user", message: { role: "user", content: "b" } }),
    ].join("\n");
    expect(parseTranscript(text).segments).toHaveLength(2);
  });

  it("merges consecutive user lines (parallel tool results)", () => {
    const text = [
      L({ type: "assistant", message: { id: "m", role: "assistant", content: [{ type: "tool_use", id: "a", name: "X", input: {} }] } }),
      L({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "1" }] } }),
      L({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: "2" }] } }),
    ].join("\n");
    const msgs = parseTranscript(text).segments[0]!.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toHaveLength(2);
  });

  it("does not merge distinct assistant messages", () => {
    const text = [
      L({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "a" }] } }),
      L({ type: "assistant", message: { id: "m2", role: "assistant", content: [{ type: "text", text: "b" }] } }),
    ].join("\n");
    expect(parseTranscript(text).segments[0]!.messages).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(parseTranscript("").segments).toEqual([]);
  });
});

describe("resendCounts", () => {
  it("counts later assistant turns", () => {
    const msgs = parseTranscript(sample()).segments[0]!.messages;
    expect(resendCounts(msgs)).toEqual([2, 1, 1, 0]);
  });
});

import { describe, expect, it } from "vitest";
import { codexSessionsDir, parseCodexRollout } from "../src/audit/codex.js";
import { simulate } from "../src/audit/simulate.js";
import type { ContentBlock } from "../src/anthropic/types.js";

const L = (o: object) => JSON.stringify(o);
const file = Array.from({ length: 60 }, (_, i) => `export const value${i} = compute(${i}, "x"); // line ${i}`).join("\n");

function rollout(): string {
  const lines = [
    L({ timestamp: "2026-11-01T10:00:00Z", type: "session_meta", payload: { id: "s-1", cwd: "/repo", originator: "codex_cli_rs", cli_version: "0.63.0" } }),
    L({ timestamp: "2026-11-01T10:00:00Z", type: "turn_context", payload: { cwd: "/repo", model: "gpt-5.1-codex", approval_policy: "on-request" } }),
    L({ timestamp: "2026-11-01T10:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix it" }] } }),
    L({ timestamp: "2026-11-01T10:00:02Z", type: "event_msg", payload: { type: "token_count", info: {} } }),
  ];
  for (let k = 0; k < 3; k++) {
    lines.push(
      L({ timestamp: `2026-11-01T10:0${k + 1}:00Z`, type: "response_item", payload: { type: "reasoning", summary: [], content: null, encrypted_content: "x" } }),
      L({
        timestamp: `2026-11-01T10:0${k + 1}:05Z`,
        type: "response_item",
        payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["cat", "src/a.ts"], workdir: "/repo" }), call_id: `call_${k}` },
      }),
      L({ timestamp: `2026-11-01T10:0${k + 1}:06Z`, type: "response_item", payload: { type: "function_call_output", call_id: `call_${k}`, output: file } }),
    );
  }
  lines.push(L({ timestamp: "2026-11-01T10:05:00Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } }));
  return lines.join("\n");
}

describe("parseCodexRollout", () => {
  it("reads metadata, model and messages", () => {
    const t = parseCodexRollout(rollout(), "/x/rollout.jsonl");
    expect(t.cwd).toBe("/repo");
    expect(t.sessionId).toBe("s-1");
    expect(t.model).toBe("gpt-5.1-codex");
    expect(t.segments).toHaveLength(1);
    const roles = t.segments[0]!.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
    const call = (t.segments[0]!.messages[1]!.content as ContentBlock[])[0] as { type: string; input: unknown };
    expect(call.type).toBe("tool_use");
    expect(call.input).toEqual({ command: ["cat", "src/a.ts"], workdir: "/repo" });
  });

  it("keeps timestamps aligned with messages", () => {
    const seg = parseCodexRollout(rollout()).segments[0]!;
    expect(seg.times).toHaveLength(seg.messages.length);
    expect(seg.times[1]).toBe(Date.parse("2026-11-01T10:01:05Z"));
  });

  it("splits at compaction", () => {
    const text = [
      L({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "a" }] } }),
      L({ type: "compacted", payload: { message: "", replacement_history: [] } }),
      L({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "b" }] } }),
    ].join("\n");
    const segs = parseCodexRollout(text).segments;
    expect(segs).toHaveLength(2);
    expect(segs[0]!.compacted).toBe(true);
  });

  it("ignores junk lines", () => {
    expect(parseCodexRollout("not json\n{}").segments).toEqual([]);
  });

  it("feeds the same simulation as Claude Code transcripts", () => {
    const s = simulate(parseCodexRollout(rollout(), "/x.jsonl"), { strategies: ["baseline", "dedup"] });
    expect(s.requests).toBe(4);
    expect(s.compressed).toBe(2);
    expect(s.bills!.dedup!.cost).toBeLessThan(s.bills!.baseline!.cost);
  });
});

describe("codexSessionsDir", () => {
  it("respects CODEX_HOME", () => {
    expect(codexSessionsDir({ CODEX_HOME: "/c" }).replace(/\\/g, "/")).toBe("/c/sessions");
  });
});

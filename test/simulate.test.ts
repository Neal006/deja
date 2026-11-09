import { describe, expect, it } from "vitest";
import { isSubagentPath, simulate } from "../src/audit/simulate.js";
import type { Transcript } from "../src/audit/transcript.js";
import { code, Conversation, numbered } from "./helpers/conversation.js";

function transcript(): Transcript {
  const file = numbered(code(60));
  const conv = new Conversation()
    .user("go")
    .tool("Read", { file_path: "/repo/a.ts" }, file)
    .tool("Read", { file_path: "/repo/a.ts" }, file)
    .tool("Bash", { command: "ls" }, "a.ts");
  // End with an assistant reply so the last tool result is resent once.
  const messages = conv.build().messages;
  messages.push({ role: "assistant", content: [{ type: "text", text: "done" }] });
  return { path: "/t.jsonl", cwd: "/repo", segments: [{ messages, times: [] }] };
}

describe("simulate", () => {
  it("counts requests and results", () => {
    const s = simulate(transcript());
    expect(s.requests).toBe(4);
    expect(s.toolResults).toBe(3);
    expect(s.compressed).toBe(1);
  });

  it("multiplies savings by resends", () => {
    const s = simulate(transcript());
    // The second read (message 4) is carried by the requests for messages 5 and 7.
    expect(s.savedSent).toBe(s.saved * 2);
    expect(s.toolTokensSent).toBeGreaterThan(s.toolTokens);
  });

  it("weights savings by cache pricing", () => {
    const s = simulate(transcript());
    expect(s.weightedSaved).toBeCloseTo(s.saved * (1.25 + 0.1));
  });

  it("attributes savings to targets", () => {
    const s = simulate(transcript());
    const read = s.targets.get("Read a.ts")!;
    expect(read.calls).toBe(2);
    expect(read.saved).toBe(s.saved);
    expect(s.targets.get("Bash `ls`")!.saved).toBe(0);
  });

  it("records context size at compaction points", () => {
    const t = transcript();
    t.segments[0]!.compacted = true;
    const s = simulate(t, { strategies: ["baseline", "deja"] });
    expect(s.compactions).toHaveLength(1);
    expect(s.compactions[0]!.deja).toBeLessThanOrEqual(s.compactions[0]!.baseline);
  });

  it("handles an empty transcript", () => {
    const s = simulate({ path: "/x", segments: [] });
    expect(s.requests).toBe(0);
    expect(s.saved).toBe(0);
  });
});

describe("isSubagentPath", () => {
  it("recognises subagent transcripts on any platform", () => {
    expect(isSubagentPath("/home/me/.claude/projects/p/abc/subagents/agent-1.jsonl")).toBe(true);
    expect(isSubagentPath("C:\\Users\\me\\.claude\\projects\\p\\abc\\subagents\\agent-1.jsonl")).toBe(true);
    expect(isSubagentPath("/home/me/.claude/projects/p/abc.jsonl")).toBe(false);
  });
});

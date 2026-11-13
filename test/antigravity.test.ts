import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { antigravityAdapter, parseAntigravityTranscript } from "../src/audit/agents/antigravity.js";
import { simulate } from "../src/audit/simulate.js";
import type { ToolResultBlock, ToolUseBlock } from "../src/anthropic/types.js";

describe("antigravity adapter", () => {
  it("associates multiple tool calls in a single PLANNER_RESPONSE with their respective outputs", () => {
    const raw = [
      JSON.stringify({
        step_index: 0,
        type: "USER_INPUT",
        content: "Run status and list files",
      }),
      JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        tool_calls: [
          { name: "run_command", args: { CommandLine: '"git status"' } },
          { name: "read_file", args: { Path: '"src/app.ts"' } },
        ],
      }),
      JSON.stringify({
        step_index: 2,
        type: "GENERIC",
        content: "branch clean",
      }),
      JSON.stringify({
        step_index: 3,
        type: "GENERIC",
        content: "export const x = 1;",
      }),
    ].join("\n");

    const t = parseAntigravityTranscript(raw);
    expect(t.segments).toHaveLength(1);
    const msgs = t.segments[0]!.messages;

    // Turn 1: user input
    expect(msgs[0]!.role).toBe("user");
    // Turn 2: assistant with 2 tool_uses
    expect(msgs[1]!.role).toBe("assistant");
    const uses = msgs[1]!.content as ToolUseBlock[];
    expect(uses).toHaveLength(2);
    expect(uses[0]!.name).toBe("run_command");
    expect(uses[0]!.id).toBe("call_1_0");
    expect(uses[1]!.name).toBe("read_file");
    expect(uses[1]!.id).toBe("call_1_1");

    // Turn 3: user tool_result for first call
    expect(msgs[2]!.role).toBe("user");
    const res1 = (msgs[2]!.content as ToolResultBlock[])[0]!;
    expect(res1.type).toBe("tool_result");
    expect(res1.tool_use_id).toBe("call_1_0");
    expect(res1.content).toBe("branch clean");

    // Turn 4: user tool_result for second call (NOT overwritten or mapped to call_1_0)
    expect(msgs[3]!.role).toBe("user");
    const res2 = (msgs[3]!.content as ToolResultBlock[])[0]!;
    expect(res2.type).toBe("tool_result");
    expect(res2.tool_use_id).toBe("call_1_1");
    expect(res2.content).toBe("export const x = 1;");
  });

  it("handles missing outputs gracefully when a new turn begins", () => {
    const raw = [
      JSON.stringify({ step_index: 0, type: "USER_INPUT", content: "cmd" }),
      JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        tool_calls: [
          { name: "toolA", args: {} },
          { name: "toolB", args: {} },
        ],
      }),
      // Only one output provided before next response
      JSON.stringify({ step_index: 2, type: "GENERIC", content: "outputA" }),
      JSON.stringify({ step_index: 3, type: "PLANNER_RESPONSE", content: "done" }),
    ].join("\n");

    const t = parseAntigravityTranscript(raw);
    const msgs = t.segments[0]!.messages;
    expect(msgs).toHaveLength(4);
    const res = (msgs[2]!.content as ToolResultBlock[])[0]!;
    expect(res.tool_use_id).toBe("call_1_0");
  });

  it("parses real anonymized fixture and simulates replay with savings", () => {
    const fixturePath = join(__dirname, "fixtures", "antigravity", "real-session.jsonl");
    const content = readFileSync(fixturePath, "utf8");
    const t = antigravityAdapter.parse(content, fixturePath);

    expect(t.segments).toHaveLength(1);
    expect(t.start).toBeDefined();
    expect(t.end).toBeDefined();

    const sim = simulate(t, { strategies: ["baseline", "dedup"] });
    expect(sim.requests).toBe(3);
    expect(sim.toolResults).toBe(3);
    // The second read of src/index.ts should be compressed
    expect(sim.compressed).toBeGreaterThanOrEqual(1);
    expect(sim.bills?.dedup?.cost).toBeLessThan(sim.bills?.baseline?.cost!);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clineAdapter, parseClineHistory } from "../src/audit/agents/cline.js";
import { discoverTranscripts } from "../src/audit/discover.js";
import { simulate } from "../src/audit/simulate.js";

describe("cline adapter", () => {
  const fixturesDir = join(__dirname, "fixtures", "cline");

  it("discovers only api_conversation_history.json and ignores ui_messages.json and metadata", () => {
    const found = discoverTranscripts(fixturesDir, {
      exactFilename: clineAdapter.exactFilename,
    });

    // Should find exactly one file across task-1 and task-2
    expect(found).toHaveLength(1);
    expect(found[0]!.path.replace(/\\/g, "/")).toContain("task-1/api_conversation_history.json");
    expect(found[0]!.path).not.toContain("ui_messages.json");
  });

  it("parses valid Cline task history into Anthropic messages", () => {
    const historyPath = join(fixturesDir, "task-1", "api_conversation_history.json");
    const content = readFileSync(historyPath, "utf8");
    const t = clineAdapter.parse(content, historyPath);

    expect(t.segments).toHaveLength(1);
    const msgs = t.segments[0]!.messages;
    expect(msgs).toHaveLength(6);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[1]!.role).toBe("assistant");
    expect(msgs[2]!.role).toBe("user");
    expect(msgs[3]!.role).toBe("assistant");
    expect(msgs[4]!.role).toBe("user");
    expect(msgs[5]!.role).toBe("assistant");
  });

  it("compresses repeated tool results in simulated replay", () => {
    const historyPath = join(fixturesDir, "task-1", "api_conversation_history.json");
    const content = readFileSync(historyPath, "utf8");
    const t = clineAdapter.parse(content, historyPath);

    const s = simulate(t, { strategies: ["baseline", "dedup"] });
    expect(s.requests).toBe(3);
    expect(s.toolResults).toBe(2);
    expect(s.compressed).toBeGreaterThanOrEqual(1);
    expect(s.bills?.dedup?.cost).toBeLessThan(s.bills?.baseline?.cost!);
  });

  it("handles malformed or empty json gracefully without throwing", () => {
    expect(parseClineHistory("not json").segments).toHaveLength(0);
    expect(parseClineHistory("{}").segments).toHaveLength(0);
    expect(parseClineHistory("[]").segments).toHaveLength(0);
  });
});

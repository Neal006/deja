import { describe, expect, it } from "vitest";
import { getAdapter, supportedAgents } from "../src/audit/agents/index.js";
import { readAny } from "../src/audit/worker.js";

describe("agent adapter registry", () => {
  it("resolves built-in adapters case-insensitively", () => {
    expect(getAdapter("claude")?.name).toBe("Claude Code");
    expect(getAdapter("CLAUDE")?.name).toBe("Claude Code");
    expect(getAdapter("codex")?.name).toBe("Codex");
    expect(getAdapter("CODEX")?.name).toBe("Codex");
    expect(getAdapter("unknown")).toBeUndefined();
  });

  it("lists supported agents", () => {
    const list = supportedAgents();
    expect(list).toContain("claude");
    expect(list).toContain("codex");
  });

  it("provides correct metadata for claude and codex", () => {
    const claude = getAdapter("claude")!;
    expect(claude.id).toBe("claude");
    expect(claude.name).toBe("Claude Code");
    expect(claude.defaultDir()).toContain(".claude");
    expect(claude.billing).toBeUndefined();

    const codex = getAdapter("codex")!;
    expect(codex.id).toBe("codex");
    expect(codex.name).toBe("Codex");
    expect(codex.defaultDir()).toContain(".codex");
    expect(codex.billing).toBeDefined();
    expect(codex.billing?.writeMultiplier).toBe(1);
    expect(codex.billing?.readMultiplier).toBe(0.1);
  });

  it("throws dynamic error message in readAny for unknown agent", () => {
    expect(() => readAny("some/path", "unknown-agent")).toThrowError(
      /Unknown agent: unknown-agent\. Supported: claude, codex/,
    );
  });
});

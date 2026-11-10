import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADAPTERS, type AgentAdapter, getAdapter, supportedAgents } from "../src/audit/agents/index.js";
import { readAny } from "../src/audit/worker.js";
import { parseArgs } from "../src/cli/args.js";
import { auditCommand } from "../src/cli/commands/audit.js";

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

  it("errors when an adapter has no default directory and --dir is omitted", async () => {
    const origMap = ADAPTERS as Map<string, AgentAdapter>;
    origMap.set("no-default", {
      id: "no-default",
      name: "No Default",
      defaultDir: () => undefined,
      parse: () => ({ path: "", segments: [] }),
    });

    let stderr = "";
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk: unknown) => {
      stderr += String(chunk);
      return true;
    };

    try {
      const code = await auditCommand(parseArgs(["audit", "--agent", "no-default"]));
      expect(code).toBe(2);
      expect(stderr).toContain("this agent has no default history location, pass --dir");
    } finally {
      process.stderr.write = origWrite;
      origMap.delete("no-default");
    }
  });

  it("proceeds when an adapter without default directory is provided --dir", async () => {
    const origMap = ADAPTERS as Map<string, AgentAdapter>;
    origMap.set("no-default", {
      id: "no-default",
      name: "No Default",
      defaultDir: () => undefined,
      parse: () => ({ path: "", segments: [] }),
    });

    let stderr = "";
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk: unknown) => {
      stderr += String(chunk);
      return true;
    };

    const emptyDir = mkdtempSync(join(tmpdir(), "deja-empty-"));
    try {
      const code = await auditCommand(parseArgs(["audit", "--agent", "no-default", "--dir", emptyDir, "--quick"]));
      expect(code).toBe(0);
      expect(stderr).not.toContain("this agent has no default history location, pass --dir");
    } finally {
      process.stderr.write = origWrite;
      origMap.delete("no-default");
    }
  });
});

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeProjectsDir, discoverTranscripts } from "../src/audit/discover.js";

function tree() {
  const root = mkdtempSync(join(tmpdir(), "deja-disc-"));
  mkdirSync(join(root, "proj-a", "sess", "subagents"), { recursive: true });
  mkdirSync(join(root, "proj-b"));
  writeFileSync(join(root, "proj-a", "1.jsonl"), "{}");
  writeFileSync(join(root, "proj-a", "sess", "subagents", "agent-1.jsonl"), "{}");
  writeFileSync(join(root, "proj-b", "2.jsonl"), "{}");
  writeFileSync(join(root, "proj-b", "notes.txt"), "x");
  const old = new Date("2020-01-01");
  utimesSync(join(root, "proj-b", "2.jsonl"), old, old);
  return root;
}

describe("discoverTranscripts", () => {
  it("finds jsonl files recursively, newest first", () => {
    const found = discoverTranscripts(tree());
    expect(found).toHaveLength(3);
    expect(found[found.length - 1]!.path).toMatch(/2\.jsonl$/);
  });

  it("filters by modification time", () => {
    expect(discoverTranscripts(tree(), { since: Date.parse("2024-01-01") })).toHaveLength(2);
  });

  it("filters by path substring", () => {
    expect(discoverTranscripts(tree(), { match: "proj-b" })).toHaveLength(1);
  });

  it("limits results", () => {
    expect(discoverTranscripts(tree(), { limit: 1 })).toHaveLength(1);
  });

  it("returns nothing for a missing directory", () => {
    expect(discoverTranscripts("/definitely/not/here")).toEqual([]);
  });
});

describe("claudeProjectsDir", () => {
  it("respects CLAUDE_CONFIG_DIR", () => {
    expect(claudeProjectsDir({ CLAUDE_CONFIG_DIR: "/cfg" })).toBe("/cfg/projects");
  });
  it("defaults to ~/.claude/projects", () => {
    expect(claudeProjectsDir({})).toMatch(/\.claude\/projects$/);
  });
});

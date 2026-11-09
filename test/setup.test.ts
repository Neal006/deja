import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeSettingsPath, installStatusline, STATUSLINE_COMMAND } from "../src/cli/commands/setup.js";

const dir = () => mkdtempSync(join(tmpdir(), "deja-setup-"));
const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

describe("installStatusline", () => {
  it("creates settings when none exist", () => {
    const path = join(dir(), "sub", "settings.json");
    expect(installStatusline(path)).toEqual({ status: "installed", path, backup: undefined });
    expect(read(path).statusLine).toEqual({ type: "command", command: STATUSLINE_COMMAND });
  });

  it("keeps other settings and writes a backup", () => {
    const path = join(dir(), "settings.json");
    writeFileSync(path, JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] } }));
    const r = installStatusline(path);
    expect(r.status).toBe("installed");
    expect(read(path)).toMatchObject({ model: "opus", permissions: { allow: ["Bash(ls)"] } });
    expect(existsSync(`${path}.deja-backup`)).toBe(true);
  });

  it("is idempotent", () => {
    const path = join(dir(), "settings.json");
    installStatusline(path);
    expect(installStatusline(path).status).toBe("already");
  });

  it("refuses to replace a custom status line without force", () => {
    const path = join(dir(), "settings.json");
    writeFileSync(path, JSON.stringify({ statusLine: { type: "command", command: "my-line" } }));
    expect(installStatusline(path).status).toBe("conflict");
    expect(read(path).statusLine).toEqual({ type: "command", command: "my-line" });
    expect(installStatusline(path, true).status).toBe("installed");
    expect(JSON.parse(readFileSync(`${path}.deja-backup`, "utf8")).statusLine.command).toBe("my-line");
  });

  it("never overwrites an unreadable file", () => {
    const path = join(dir(), "settings.json");
    writeFileSync(path, "{ broken");
    expect(installStatusline(path).status).toBe("invalid");
    expect(readFileSync(path, "utf8")).toBe("{ broken");
  });
});

describe("claudeSettingsPath", () => {
  it("respects CLAUDE_CONFIG_DIR", () => {
    expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: "/cfg" })).toBe(join("/cfg", "settings.json"));
  });
});

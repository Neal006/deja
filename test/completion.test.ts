import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bashCompletion, COMMANDS, fishCompletion, zshCompletion } from "../src/cli/commands/completion.js";

const HELP = readFileSync(join(import.meta.dirname, "..", "src", "cli", "help.ts"), "utf8");

describe("completions", () => {
  it("cover every command listed in the help text", () => {
    for (const m of HELP.matchAll(/^ {2}deja ([a-z]+)/gm)) {
      expect(Object.keys(COMMANDS)).toContain(m[1]);
    }
  });

  it("bash script is syntactically valid", () => {
    const script = bashCompletion();
    expect(script).toContain("complete -F _deja deja");
    expect(script).toContain("--by-project");
    if (process.platform !== "win32") {
      expect(() => execFileSync("bash", ["-n"], { input: script })).not.toThrow();
    }
  });

  it("zsh script registers the function", () => {
    expect(zshCompletion()).toContain("compdef _deja deja");
  });

  it("fish script lists long flags without dashes", () => {
    const s = fishCompletion();
    expect(s).toContain('-n "__fish_seen_subcommand_from audit" -l share');
    expect(s).toContain('-n "__fish_seen_subcommand_from setup" -a statusline');
  });
});

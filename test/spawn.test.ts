import { describe, expect, it } from "vitest";
import { launchArgs, quoteWindowsArg, resolveWindowsCommand } from "../src/cli/spawn.js";

describe("quoteWindowsArg", () => {
  it.each([
    ["simple", "simple"],
    ["", '""'],
    ["has space", '"has space"'],
    ['say "hi"', '"say \\"hi\\""'],
    ["C:\\path with space\\", '"C:\\path with space\\\\"'],
    ["a&b", '"a&b"'],
    ["50%", '"50%"'],
    ["--flag=value", '"--flag=value"'],
  ])("%j -> %s", (arg, quoted) => expect(quoteWindowsArg(arg)).toBe(quoted));
});

describe("launchArgs", () => {
  it("passes through on POSIX", () => {
    expect(launchArgs("claude", ["-p", "two words"], "linux")).toEqual({ command: "claude", args: ["-p", "two words"], shell: false });
  });
  const env = { PATH: "C:\\bin;C:\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  const files = new Set(["C:\\bin\\node.exe", "C:\\npm\\claude.cmd"]);
  const exists = (p: string) => files.has(p);

  it("starts real executables directly on Windows", () => {
    expect(launchArgs("node", ["-e", "a\nb"], "win32", env, exists)).toEqual({ command: "C:\\bin\\node.exe", args: ["-e", "a\nb"], shell: false });
  });

  it("quotes and uses a shell for .cmd shims on Windows", () => {
    expect(launchArgs("claude", ["-p", "two words"], "win32", env, exists)).toEqual({
      command: "C:\\npm\\claude.cmd",
      args: ["-p", '"two words"'],
      shell: true,
    });
  });

  it("falls back to a shell for unknown commands on Windows", () => {
    expect(launchArgs("mystery", [], "win32", env, exists).shell).toBe(true);
  });
});

describe("resolveWindowsCommand", () => {
  const env = { PATH: "C:\\a;C:\\b\\", PATHEXT: ".EXE;.CMD" };
  it("searches PATH in order with PATHEXT", () => {
    const files = new Set(["C:\\b\\tool.cmd", "C:\\a\\tool.exe"]);
    expect(resolveWindowsCommand("tool", env, (p) => files.has(p))).toBe("C:\\a\\tool.exe");
  });
  it("respects an explicit extension", () => {
    expect(resolveWindowsCommand("tool.cmd", env, (p) => p === "C:\\b\\tool.cmd")).toBe("C:\\b\\tool.cmd");
  });
  it("returns undefined when nothing matches", () => {
    expect(resolveWindowsCommand("nope", env, () => false)).toBeUndefined();
  });
});

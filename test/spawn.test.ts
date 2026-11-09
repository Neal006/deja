import { describe, expect, it } from "vitest";
import { launchArgs, quoteWindowsArg } from "../src/cli/spawn.js";

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
  it("quotes and uses a shell on Windows", () => {
    expect(launchArgs("claude", ["-p", "two words"], "win32")).toEqual({ command: "claude", args: ["-p", '"two words"'], shell: true });
  });
});

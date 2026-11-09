import { describe, expect, it } from "vitest";
import { flagNumber, flagString, parseArgs, parseDuration } from "../src/cli/args.js";

describe("parseArgs", () => {
  it("parses a command and positionals", () => {
    const a = parseArgs(["stats", "extra"]);
    expect(a.command).toBe("stats");
    expect(a.positionals).toEqual(["extra"]);
  });

  it("parses --flag value and --flag=value", () => {
    const a = parseArgs(["start", "--port", "9000", "--upstream=https://x"]);
    expect(a.flags).toEqual({ port: "9000", upstream: "https://x" });
  });

  it("parses boolean flags", () => {
    const a = parseArgs(["stats", "--json", "--no-color"]);
    expect(a.flags).toEqual({ json: true, color: false });
  });

  it("treats a following dash-arg as a new flag", () => {
    expect(parseArgs(["--json", "--port", "1"]).flags).toEqual({ json: true, port: "1" });
  });

  it("parses short flags", () => {
    expect(parseArgs(["-h"]).flags).toEqual({ h: true });
  });

  it("collects everything after -- verbatim", () => {
    const a = parseArgs(["run", "--port", "1", "--", "aider", "--model", "x"]);
    expect(a.command).toBe("run");
    expect(a.rest).toEqual(["aider", "--model", "x"]);
    expect(a.flags).toEqual({ port: "1" });
  });
});

describe("flag helpers", () => {
  it("reads strings and numbers", () => {
    const { flags } = parseArgs(["--port", "8787", "--json"]);
    expect(flagString(flags, "port")).toBe("8787");
    expect(flagString(flags, "json")).toBeUndefined();
    expect(flagNumber(flags, "port")).toBe(8787);
    expect(flagNumber(flags, "missing")).toBeUndefined();
  });
  it("rejects non-numeric numbers", () => {
    expect(flagNumber({ port: "abc" }, "port")).toBeUndefined();
  });
});

describe("parseDuration", () => {
  it.each([
    ["30s", 30_000],
    ["5m", 300_000],
    ["2h", 7_200_000],
    ["7d", 604_800_000],
    ["1w", 604_800_000],
    ["1.5h", 5_400_000],
  ])("%s", (s, ms) => expect(parseDuration(s)).toBe(ms));

  it("rejects garbage", () => {
    expect(parseDuration("yesterday")).toBeUndefined();
    expect(parseDuration("5")).toBeUndefined();
  });
});

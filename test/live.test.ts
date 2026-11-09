import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { statusText } from "../src/cli/commands/statusline.js";
import { livePath, portFromBaseUrl, readLive, removeLive, writeLive, type LiveTally } from "../src/proxy/live.js";

const tally: LiveTally = { port: 4321, pid: 1, started: 0, requests: 12, saved: 45_600, usd: 0.42, evicted: 3 };

describe("live tally", () => {
  it("round-trips through DEJA_HOME", () => {
    const env = { DEJA_HOME: mkdtempSync(join(tmpdir(), "deja-live-")) };
    writeLive(tally, env);
    expect(readLive(4321, env)).toEqual(tally);
    removeLive(4321, env);
    expect(existsSync(livePath(4321, env))).toBe(false);
  });

  it("returns undefined for an unknown port", () => {
    expect(readLive(1, { DEJA_HOME: mkdtempSync(join(tmpdir(), "deja-live-")) })).toBeUndefined();
  });
});

describe("portFromBaseUrl", () => {
  it.each([
    ["http://127.0.0.1:41234", 41234],
    ["http://localhost:8787/v1", 8787],
    ["https://api.anthropic.com", undefined],
    ["not a url", undefined],
    [undefined, undefined],
  ])("%s -> %s", (url, port) => expect(portFromBaseUrl(url)).toBe(port));
});

describe("statusText", () => {
  it("shows savings", () => expect(statusText(tally)).toBe("deja ↓45.6k tok · $0.42 · 3 stubbed"));
  it("shows activity before savings", () => expect(statusText({ ...tally, saved: 0 })).toBe("deja ✓ 12 req"));
  it("shows off without a proxy", () => expect(statusText(undefined)).toBe("deja: off"));
});

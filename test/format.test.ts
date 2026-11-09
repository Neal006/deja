import { describe, expect, it } from "vitest";
import { bar, paint, percent, usd, useColor } from "../src/cli/format.js";

const tty = { isTTY: true } as NodeJS.WriteStream;
const pipe = { isTTY: false } as NodeJS.WriteStream;

describe("useColor", () => {
  it("colors TTYs", () => expect(useColor(tty, {})).toBe(true));
  it("does not color pipes", () => expect(useColor(pipe, {})).toBe(false));
  it("honours NO_COLOR", () => expect(useColor(tty, { NO_COLOR: "1" })).toBe(false));
  it("honours FORCE_COLOR", () => expect(useColor(pipe, { FORCE_COLOR: "1" })).toBe(true));
});

describe("paint", () => {
  it("wraps when on", () => expect(paint(true).green("x")).toBe("\x1b[32mx\x1b[39m"));
  it("is identity when off", () => expect(paint(false).bold("x")).toBe("x"));
});

describe("usd", () => {
  it.each([
    [0, "$0"],
    [0.0042, "$0.0042"],
    [1.5, "$1.50"],
    [1234.6, "$1,235"],
  ])("%d -> %s", (n, s) => expect(usd(n)).toBe(s));
});

describe("percent", () => {
  it("formats a share", () => expect(percent(1, 4)).toBe("25.0%"));
  it("handles zero totals", () => expect(percent(1, 0)).toBe("0%"));
});

describe("bar", () => {
  it("fills proportionally", () => expect(bar(0.5, 4)).toBe("██░░"));
  it("clamps", () => {
    expect(bar(2, 3)).toBe("███");
    expect(bar(-1, 3)).toBe("░░░");
  });
});

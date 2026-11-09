import { describe, expect, it } from "vitest";
import { compressText, DEFAULT_COMPRESS } from "../src/core/compress.js";
import { Dictionary } from "../src/core/dictionary.js";

function numbered(body: string[], start = 1): string {
  return body.map((b, i) => `${String(i + start).padStart(6)}\t${b}`).join("\n");
}

function code(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `  export function handler${i}(req: Request) { return respond(req, ${i}); }`);
}

function seed(dict: Dictionary, id: string, label: string, text: string) {
  dict.add(compressText(id, label, text, dict).source);
}

describe("compressText", () => {
  it("passes text through when the dictionary is empty", () => {
    const text = numbered(code(40));
    const r = compressText("a", "Read x.ts", text, new Dictionary());
    expect(r.changed).toBe(false);
    expect(r.text).toBe(text);
    expect(r.source.lines).toHaveLength(40);
  });

  it("collapses an identical re-read into a single reference", () => {
    const d = new Dictionary();
    const text = numbered(code(80));
    seed(d, "a", "Read src/x.ts", text);
    const r = compressText("b", "Read src/x.ts", text, d);
    expect(r.changed).toBe(true);
    expect(r.text).toContain("⟨same as all of Read src/x.ts⟩");
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore / 10);
    expect(r.source.lines).toHaveLength(0);
  });

  it("shows only the changed region of an edited file", () => {
    const d = new Dictionary();
    const before = code(60);
    seed(d, "a", "Read src/x.ts", numbered(before));
    const after = [...before.slice(0, 30), "  // TODO: changed by an edit", ...before.slice(30)];
    const r = compressText("b", "Read src/x.ts", numbered(after), d);
    expect(r.changed).toBe(true);
    const lines = r.text.split("\n");
    expect(lines[1]).toBe("  1-30\t⟨same as Read src/x.ts lines 1-30⟩");
    expect(lines[2]).toBe("    31\t  // TODO: changed by an edit");
    expect(lines[3]).toBe(" 32-61\t⟨same as Read src/x.ts lines 31-60⟩");
    expect(r.source.lines.map((l) => l.num)).toEqual([31]);
  });

  it("uses quoted anchors when the source has no line numbers", () => {
    const d = new Dictionary();
    const log = Array.from({ length: 30 }, (_, i) => `✓ test/suite${i}.test.ts > does thing ${i} (3ms)`);
    seed(d, "a", "Bash `npm test`", log.join("\n"));
    const rerun = [...log, "✗ test/new.test.ts > fails now", "Tests 1 failed | 30 passed"];
    const r = compressText("b", "Bash `npm test`", rerun.join("\n"), d);
    expect(r.changed).toBe(true);
    expect(r.text).toContain("⟨30 lines same as all of Bash `npm test`⟩");
    expect(r.text).toContain("✗ test/new.test.ts > fails now");
  });

  it("refuses to compress when savings are too small", () => {
    const d = new Dictionary();
    const base = code(8);
    seed(d, "a", "Read y.ts", numbered(base));
    const fresh = Array.from({ length: 120 }, (_, i) => `const novelValue${i} = buildSomethingEntirelyDifferent(${i}, "x");`);
    const r = compressText("b", "Read y.ts", numbered([...base, ...fresh]), d);
    expect(r.changed).toBe(false);
  });

  it("is deterministic for the same prefix", () => {
    const build = () => {
      const d = new Dictionary();
      seed(d, "a", "Read z.ts", numbered(code(50)));
      return compressText("b", "Read z.ts", numbered([...code(25), "// x", ...code(50).slice(25)]), d).text;
    };
    expect(build()).toBe(build());
  });

  it("never references content that was itself only a reference", () => {
    const d = new Dictionary();
    const text = numbered(code(50));
    seed(d, "a", "Read q.ts", text);
    seed(d, "b", "Read q.ts", text); // fully referenced, contributes no visible lines
    const r = compressText("c", "Read q.ts", text, d);
    expect(r.text).toContain("all of Read q.ts");
    expect(d.sources[1]!.lines).toHaveLength(0);
  });

  it("passes oversized text through untouched and unindexed", () => {
    const d = new Dictionary();
    const text = numbered(code(80));
    seed(d, "a", "Read big.ts", text);
    const r = compressText("b", "Read big.ts", text, d, { ...DEFAULT_COMPRESS, maxInputChars: 100 });
    expect(r.changed).toBe(false);
    expect(r.text).toBe(text);
    expect(r.source.lines).toEqual([]);
  });

  it("preserves a trailing newline", () => {
    const d = new Dictionary();
    const text = `${numbered(code(40))}\n`;
    seed(d, "a", "Read t.ts", text);
    const r = compressText("b", "Read t.ts", text, d);
    expect(r.text.endsWith("\n")).toBe(true);
  });
});

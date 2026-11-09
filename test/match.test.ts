import { describe, expect, it } from "vitest";
import { Dictionary, literalSource } from "../src/core/dictionary.js";
import { splitLines } from "../src/core/lines.js";
import { findSegments, type RefSegment } from "../src/core/match.js";

function numbered(body: string[]): string {
  return body.map((b, i) => `${String(i + 1).padStart(6)}\t${b}`).join("\n");
}

function fileLines(n: number, prefix = "line"): string[] {
  return Array.from({ length: n }, (_, i) => `const ${prefix}${i} = computeSomething(${i}, "value-${i}");`);
}

function dictWith(text: string, id = "t1", label = "Read a.ts"): Dictionary {
  const d = new Dictionary();
  const lines = splitLines(text);
  d.add(literalSource(id, label, lines, true));
  return d;
}

describe("findSegments", () => {
  it("returns a single literal segment against an empty dictionary", () => {
    const segs = findSegments(splitLines(fileLines(10).join("\n")), new Dictionary());
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe("lit");
  });

  it("references an identical re-read entirely", () => {
    const text = numbered(fileLines(50));
    const segs = findSegments(splitLines(text), dictWith(text));
    expect(segs).toHaveLength(1);
    const ref = segs[0] as RefSegment;
    expect(ref.kind).toBe("ref");
    expect(ref.len).toBe(50);
    expect(ref.from).toBe(0);
  });

  it("matches across shifted line numbers after an insertion", () => {
    const before = fileLines(40);
    const after = [...before.slice(0, 20), "// a brand new line inserted here", ...before.slice(20)];
    const segs = findSegments(splitLines(numbered(after)), dictWith(numbered(before)));
    expect(segs.map((s) => s.kind)).toEqual(["ref", "lit", "ref"]);
    const tail = segs[2] as RefSegment;
    expect(tail.from).toBe(20);
    expect(tail.len).toBe(20);
    expect(tail.lines[0]!.num).toBe(22);
  });

  it("keeps short matches literal", () => {
    const before = fileLines(4);
    const segs = findSegments(splitLines(numbered(before)), dictWith(numbered(before)));
    expect(segs.every((s) => s.kind === "lit")).toBe(true);
  });

  it("does not reference runs made of trivial lines", () => {
    const braces = Array.from({ length: 20 }, () => "}").join("\n");
    const segs = findSegments(splitLines(braces), dictWith(braces));
    expect(segs.every((s) => s.kind === "lit")).toBe(true);
  });

  it("prefers the most recent source on ties", () => {
    const text = numbered(fileLines(30));
    const d = new Dictionary();
    d.add(literalSource("old", "Read a.ts", splitLines(text), true));
    d.add(literalSource("new", "Read a.ts", splitLines(text), true));
    const segs = findSegments(splitLines(text), d);
    expect((segs[0] as RefSegment).source.id).toBe("new");
  });

  it("prefers the longest run over recency", () => {
    const long = numbered(fileLines(30));
    const short = numbered(fileLines(10));
    const d = new Dictionary();
    d.add(literalSource("long", "Read a.ts", splitLines(long), true));
    d.add(literalSource("short", "Read a.ts", splitLines(short), true));
    const segs = findSegments(splitLines(long), d);
    expect(segs).toHaveLength(1);
    expect((segs[0] as RefSegment).source.id).toBe("long");
  });

  it("never extends a run across visible blocks", () => {
    const lines = splitLines(fileLines(20).join("\n"));
    const d = new Dictionary();
    d.add({
      id: "c",
      label: "Bash ls",
      numbered: false,
      lines: lines.map((l, i) => ({ body: l.body, num: null, pos: i + 1, block: i < 10 ? 0 : 1 })),
    });
    const segs = findSegments(lines, d);
    const refs = segs.filter((s): s is RefSegment => s.kind === "ref");
    expect(refs.every((r) => r.len <= 10)).toBe(true);
  });

  it("matches content from a different tool (bash cat vs read)", () => {
    const body = fileLines(25);
    const d = dictWith(numbered(body));
    const segs = findSegments(splitLines(body.join("\n")), d);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe("ref");
  });
});

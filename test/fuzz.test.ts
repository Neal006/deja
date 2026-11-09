import { describe, expect, it } from "vitest";
import { transformRequest } from "../src/anthropic/transform.js";
import { Dictionary, literalSource } from "../src/core/dictionary.js";
import { isNumbered, splitLines } from "../src/core/lines.js";
import { findSegments } from "../src/core/match.js";
import { Conversation } from "./helpers/conversation.js";

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCAB = [
  "const result = await fetchUser(id);",
  "if (!result.ok) throw new Error(result.error);",
  "return transform(result.value, options);",
  "}",
  "",
  "export function handler(req: Request): Response {",
  "  logger.info('handling request', { path: req.url });",
  "PASS test/unit/parser.test.ts (14 tests) 23ms",
  "FAIL test/unit/lexer.test.ts > tokenizes strings",
  "  expected 'a' to equal 'b'",
  "import { join } from 'node:path';",
  "    at Object.<anonymous> (src/index.ts:12:5)",
];

function randomFile(r: () => number, lines: number): string[] {
  return Array.from({ length: lines }, (_, i) => {
    const base = VOCAB[Math.floor(r() * VOCAB.length)]!;
    // Mix in unique lines so files are not all identical.
    return r() < 0.5 ? `${base} // ${i}-${Math.floor(r() * 1000)}` : base;
  });
}

/** Mutate a file: random insertions, deletions and edits. */
function mutate(r: () => number, file: string[]): string[] {
  const out = [...file];
  const ops = 1 + Math.floor(r() * 4);
  for (let k = 0; k < ops; k++) {
    const at = Math.floor(r() * (out.length + 1));
    const op = r();
    if (op < 0.4) out.splice(at, 0, `// inserted ${Math.floor(r() * 1e6)}`);
    else if (op < 0.7 && out.length > 1) out.splice(Math.min(at, out.length - 1), 1);
    else if (out.length > 0) out[Math.min(at, out.length - 1)] = `// edited ${Math.floor(r() * 1e6)}`;
  }
  return out;
}

const numbered = (lines: string[]) => lines.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join("\n");

describe("fuzz: dedup is lossless", () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const dict = new Dictionary();
      let file = randomFile(r, 20 + Math.floor(r() * 120));
      for (let round = 0; round < 4; round++) {
        const text = r() < 0.7 ? numbered(file) : file.join("\n");
        const lines = splitLines(text);
        const segments = findSegments(lines, dict);
        // Expanding every reference from its source must give back the
        // original line bodies, in order, with nothing lost or invented.
        const rebuilt: string[] = [];
        for (const seg of segments) {
          if (seg.kind === "lit") rebuilt.push(...seg.lines.map((l) => l.body));
          else {
            const src = seg.source.lines.slice(seg.from, seg.from + seg.len);
            expect(new Set(src.map((l) => l.block)).size).toBe(1);
            rebuilt.push(...src.map((l) => l.body));
          }
        }
        expect(rebuilt).toEqual(lines.map((l) => l.body));
        dict.add(literalSource(`t${round}`, `Read f (${round})`, lines, isNumbered(lines)));
        file = mutate(r, file);
      }
    });
  }
});

describe("fuzz: transforms are prefix-deterministic", () => {
  for (let seed = 1; seed <= 30; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(1000 + seed);
      const conv = new Conversation();
      let file = randomFile(r, 30 + Math.floor(r() * 100));
      let previous: string[] = [];
      for (let step = 0; step < 6; step++) {
        const roll = r();
        if (roll < 0.5) conv.tool("Read", { file_path: "/repo/f.ts" }, numbered(file));
        else if (roll < 0.8) conv.tool("Bash", { command: "npm test" }, randomFile(r, 15).join("\n"));
        else conv.tool("Write", { file_path: "/repo/f.ts", content: file.join("\n") }, "ok");
        file = mutate(r, file);
        const out = transformRequest(conv.build()).body.messages.map((m) => JSON.stringify(m));
        // Every message sent before must come out byte-identical.
        expect(out.slice(0, previous.length)).toEqual(previous);
        previous = out;
      }
    });
  }
});

describe("fuzz: decay keeps determinism and never references evicted text", () => {
  const ORD = ["", "", "2nd", "3rd", "4th", "5th"];
  for (let seed = 1; seed <= 30; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(5000 + seed);
      const conv = new Conversation();
      const labels: string[] = [];
      const counts = new Map<string, number>();
      let file = randomFile(r, 40 + Math.floor(r() * 80));
      for (let step = 0; step < 5; step++) {
        const read = r() < 0.6;
        conv.tool(read ? "Read" : "Bash", read ? { file_path: "/repo/f.ts" } : { command: "cat f.ts" }, numbered(file));
        const base = read ? "Read f.ts" : "Bash `cat f.ts`";
        const k = (counts.get(base) ?? 0) + 1;
        counts.set(base, k);
        labels.push(k === 1 ? base : `${base} (${ORD[k]} time)`);
        file = mutate(r, file);
      }
      const ids = labels.map((_, i) => `toolu_${String(i + 1).padStart(4, "0")}`);
      const evict = new Set(ids.filter(() => r() < 0.4));
      const once = transformRequest(conv.build(), { evict }).body;
      const twice = transformRequest(conv.build(), { evict }).body;
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
      // No reference may point at a call whose content was evicted. These are
      // the exact forms the renderer produces for a target label.
      const text = JSON.stringify(once);
      ids.forEach((id, i) => {
        if (!evict.has(id)) return;
        const label = labels[i]!;
        expect(text).not.toContain(`same as all of ${label}⟩`);
        expect(text).not.toContain(`same as ${label} lines `);
        expect(text).not.toContain(`same as ${label}, from `);
      });
    });
  }
});

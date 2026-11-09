import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulateMany } from "../src/audit/pool.js";
import { writeTranscript } from "./helpers/transcripts.js";

describe("simulateMany", () => {
  it("simulates in-process and keeps order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deja-pool-"));
    const paths = [writeTranscript(dir, "a"), writeTranscript(dir, "b")];
    const progress: number[] = [];
    const out = await simulateMany(paths, { strategies: ["baseline", "deja"], jobs: 1, onProgress: (d) => progress.push(d) });
    expect(out.map((s) => s.sessionId)).toEqual(["a", "b"]);
    expect(out[0]!.compressed).toBe(2);
    expect(out[0]!.bills?.deja?.cost).toBeLessThan(out[0]!.bills!.baseline!.cost);
    expect(progress).toEqual([1, 2]);
  });

  it("skips unreadable transcripts", async () => {
    const out = await simulateMany(["/definitely/missing.jsonl"], { strategies: [], jobs: 1 });
    expect(out).toEqual([]);
  });
});

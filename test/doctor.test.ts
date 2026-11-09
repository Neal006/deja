import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkBaseUrl,
  checkClaude,
  checkHome,
  checkNode,
  checkTranscripts,
  checkUpstream,
  renderChecks,
} from "../src/cli/commands/doctor.js";

describe("doctor checks", () => {
  it("accepts modern node and rejects old node", () => {
    expect(checkNode("22.1.0").status).toBe("ok");
    expect(checkNode("18.19.0").status).toBe("fail");
  });

  it("accepts a writable home", () => {
    expect(checkHome(join(mkdtempSync(join(tmpdir(), "deja-doc-")), "h")).status).toBe("ok");
  });

  it("fails an unusable home", () => {
    // A path below a regular file can never be created (ENOTDIR).
    const file = join(mkdtempSync(join(tmpdir(), "deja-doc-")), "file");
    writeFileSync(file, "x");
    expect(checkHome(join(file, "home")).status).toBe("fail");
  });

  it("warns when claude is missing", () => {
    expect(checkClaude("definitely-not-a-real-binary-xyz").status).toBe("warn");
  });

  it("finds claude-like binaries", () => {
    const c = checkClaude("node");
    expect(c.status).toBe("ok");
    expect(c.detail).toMatch(/^v\d+/);
  });

  it("warns when there is no history", () => {
    expect(checkTranscripts("/definitely/not/here").status).toBe("warn");
  });

  it("describes the base url", () => {
    expect(checkBaseUrl({}).detail).toContain("unset");
    expect(checkBaseUrl({ ANTHROPIC_BASE_URL: "https://gw" }).detail).toContain("chain in front");
  });

  it("reports upstream reachability", async () => {
    const ok = await checkUpstream("https://x", (async () => new Response(null, { status: 404 })) as typeof fetch);
    expect(ok).toMatchObject({ status: "ok", detail: "https://x reachable (HTTP 404)" });
    const bad = await checkUpstream("https://x", (async () => {
      throw new Error("ENOTFOUND");
    }) as typeof fetch);
    expect(bad.status).toBe("warn");
  });

  it("renders a checklist", () => {
    const out = renderChecks([{ name: "node", status: "ok", detail: "v22" }, { name: "x", status: "fail", detail: "bad" }], false);
    expect(out).toBe("✓ node         v22\n✗ x            bad");
  });
});

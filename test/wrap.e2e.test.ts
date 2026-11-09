import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readEntries } from "../src/core/ledger.js";
import { code, Conversation, numbered } from "./helpers/conversation.js";
import { writeTranscript } from "./helpers/transcripts.js";

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");

let upstream: Server;
let upstreamUrl: string;
let lastBody = "";

beforeAll(async () => {
  // Run tsc through node directly: `npx` is a .cmd shim on Windows.
  await run(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: ROOT });
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastBody = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"type":"message"}');
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
}, 60_000);

afterAll(() => new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r())));

describe("deja run (end to end)", () => {
  it("routes a child agent through the proxy and records savings", async () => {
    const home = mkdtempSync(join(tmpdir(), "deja-e2e-"));
    const file = numbered(code(80));
    const body = JSON.stringify(
      new Conversation().tool("Read", { file_path: "/repo/a.ts" }, file).tool("Read", { file_path: "/repo/a.ts" }, file).build(),
    );
    // The "agent" is a node one-liner that posts a request to ANTHROPIC_BASE_URL.
    const agent = `fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", {method: "POST", headers: {"content-type": "application/json"}, body: process.env.BODY}).then(r => r.text()).then(t => console.log(t))`;
    const { stdout, stderr } = await run(
      "node",
      [join(ROOT, "dist/cli.js"), "run", "--upstream", upstreamUrl, "--", "node", "-e", agent],
      { env: { ...process.env, DEJA_HOME: home, BODY: body, NO_COLOR: "1" } },
    );
    expect(stdout.trim()).toBe('{"type":"message"}');
    expect(lastBody).toContain("same as all of Read a.ts");
    expect(lastBody.length).toBeLessThan(body.length);
    expect(stderr).toMatch(/deja saved .* input tokens across 1 requests/);
    expect(readEntries(join(home, "ledger.jsonl"))).toHaveLength(1);
  }, 30_000);

  it("propagates the child's exit code", async () => {
    const home = mkdtempSync(join(tmpdir(), "deja-e2e-"));
    await expect(
      run("node", [join(ROOT, "dist/cli.js"), "run", "--upstream", upstreamUrl, "--", "node", "-e", "process.exit(7)"], {
        env: { ...process.env, DEJA_HOME: home },
      }),
    ).rejects.toMatchObject({ code: 7 });
  }, 30_000);
});

describe("deja audit (end to end)", () => {
  it("replays transcripts in worker threads and reports JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deja-audit-e2e-"));
    for (const n of ["s1", "s2", "s3"]) writeTranscript(dir, n);
    const { stdout } = await run("node", [join(ROOT, "dist/cli.js"), "audit", "--dir", dir, "--since", "1000w", "--jobs", "2", "--json"], {
      env: { ...process.env, NO_COLOR: "1" },
    });
    const report = JSON.parse(stdout) as { sessions: number; bills: { baseline: { cost: number }; deja: { cost: number } } };
    expect(report.sessions).toBe(3);
    expect(report.bills.deja.cost).toBeLessThan(report.bills.baseline.cost);
  }, 60_000);
});

describe("deja statusline (end to end)", () => {
  it("reports the running proxy's savings from inside the wrapped agent", async () => {
    const home = mkdtempSync(join(tmpdir(), "deja-sl-"));
    const file = numbered(code(80));
    const body = JSON.stringify(
      new Conversation().tool("Read", { file_path: "/repo/a.ts" }, file).tool("Read", { file_path: "/repo/a.ts" }, file).build(),
    );
    // The "agent" makes one request, then runs the status line command the
    // way Claude Code would.
    const cli = join(ROOT, "dist/cli.js");
    const agent = `
      const { execFileSync } = require("node:child_process");
      fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", body: process.env.BODY })
        .then((r) => r.text())
        .then(() => new Promise((r) => setTimeout(r, 100)))
        .then(() => process.stdout.write(execFileSync("node", [${JSON.stringify(cli)}, "statusline"], { encoding: "utf8" })));`;
    const { stdout } = await run("node", [cli, "run", "--upstream", upstreamUrl, "--", "node", "-e", agent], {
      env: { ...process.env, DEJA_HOME: home, BODY: body, NO_COLOR: "1" },
    });
    expect(stdout).toMatch(/^deja ↓[\d.]+k? tok · \$/m);
  }, 30_000);
});

describe("deja start (end to end)", () => {
  it("serves health, proxies, and prints a summary on SIGINT", async () => {
    if (process.platform === "win32") return; // no SIGINT delivery to child processes on Windows
    const { spawn } = await import("node:child_process");
    const home = mkdtempSync(join(tmpdir(), "deja-start-"));
    const child = spawn(process.execPath, [join(ROOT, "dist/cli.js"), "start", "--port", "0", "--upstream", upstreamUrl], {
      env: { ...process.env, DEJA_HOME: home, NO_COLOR: "1" },
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const url = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no listen line: ${stderr}`)), 10_000);
      const check = () => {
        const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stderr);
        if (m) {
          clearTimeout(t);
          resolve(m[1]!);
        } else setTimeout(check, 50);
      };
      check();
    });
    expect(((await (await fetch(`${url}/deja/health`)).json()) as { ok: boolean }).ok).toBe(true);
    const file = numbered(code(80));
    const body = JSON.stringify(new Conversation().tool("Read", { file_path: "/repo/a.ts" }, file).tool("Read", { file_path: "/repo/a.ts" }, file).build());
    await (await fetch(`${url}/v1/messages`, { method: "POST", body })).text();
    const exited = new Promise<number | null>((r) => child.on("exit", r));
    child.kill("SIGINT");
    expect(await exited).toBe(0);
    expect(stderr).toMatch(/deja saved .* input tokens across 1 requests/);
  }, 30_000);
});

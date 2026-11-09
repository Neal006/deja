#!/usr/bin/env node
/**
 * Task-success benchmark: does the agent still finish the job through deja?
 *
 * Runs Claude Code headless on each task in bench/tasks, once with deja off
 * (`deja --off claude`, same proxy, requests untouched) and once with deja on,
 * each in a fresh copy of the task's repo. A task passes when its check.mjs
 * exits 0. Cost and tokens come from Claude Code's own JSON result, so both
 * arms are measured the same way.
 *
 *   npm run build
 *   node scripts/quality-bench.mjs [--runs 3] [--model haiku] [--task fix-cart] [--out bench-results.json] [--keep]
 *
 * Needs Claude Code on PATH, git, and an API key or login. It spends real money:
 * runs x tasks x 2 Claude Code sessions.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const tasksDir = join(root, "bench", "tasks");

function parseFlags(argv) {
  const flags = { runs: 3, model: "haiku", task: undefined, out: "bench-results.json", keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep") flags.keep = true;
    else if (a === "--runs") flags.runs = Number(argv[++i]);
    else if (a === "--model") flags.model = argv[++i];
    else if (a === "--task") flags.task = argv[++i];
    else if (a === "--out") flags.out = argv[++i];
    else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(flags.runs) || flags.runs < 1) {
    console.error("--runs must be a positive integer");
    process.exit(2);
  }
  return flags;
}

function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@localhost", ...args], { cwd, stdio: "ignore" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
}

/** The last JSON object Claude Code printed: its `--output-format json` result. */
function parseResult(stdout) {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function runOnce(taskName, task, arm, model) {
  const taskDir = join(tasksDir, taskName);
  const work = mkdtempSync(join(tmpdir(), `deja-bench-${taskName}-`));
  const home = mkdtempSync(join(tmpdir(), "deja-bench-home-"));
  cpSync(join(taskDir, "repo"), work, { recursive: true });
  git(work, "init", "-q");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "task");

  const args = [cli, ...(arm === "off" ? ["--off"] : []), "--quiet", "claude", "-p", task.prompt, "--output-format", "json", "--model", model];
  if (task.allowedTools) args.push("--allowedTools", task.allowedTools);
  if (task.maxTurns) args.push("--max-turns", String(task.maxTurns));

  const started = Date.now();
  const agent = spawnSync(process.execPath, args, {
    cwd: work,
    env: { ...process.env, DEJA_HOME: home },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  const seconds = (Date.now() - started) / 1000;
  const result = parseResult(agent.stdout ?? "");

  const check = spawnSync(process.execPath, [join(taskDir, "check.mjs")], { cwd: work, encoding: "utf8" });
  const usage = result?.usage ?? {};
  const run = {
    task: taskName,
    arm,
    pass: check.status === 0,
    check: (check.stdout ?? "").trim(),
    agentExit: agent.status,
    agentError: result?.is_error ?? result === undefined,
    turns: result?.num_turns,
    costUsd: result?.total_cost_usd,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
    outputTokens: usage.output_tokens,
    seconds,
    workDir: work,
  };
  if (result === undefined) run.stderr = (agent.stderr ?? "").slice(-2000);
  return { run, work, home };
}

const mean = (xs) => {
  const v = xs.filter((x) => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};
const fmt = (x, digits = 0) => (x === undefined ? "—" : x.toFixed(digits));

function summarize(runs) {
  const rows = [];
  const tasks = [...new Set(runs.map((r) => r.task))];
  for (const task of [...tasks, "all"]) {
    for (const arm of ["off", "on"]) {
      const rs = runs.filter((r) => (task === "all" || r.task === task) && r.arm === arm);
      if (rs.length === 0) continue;
      rows.push({
        task,
        arm,
        passed: `${rs.filter((r) => r.pass).length}/${rs.length}`,
        cost: mean(rs.map((r) => r.costUsd)),
        input: mean(rs.map((r) => r.inputTokens)),
        turns: mean(rs.map((r) => r.turns)),
      });
    }
  }
  console.log("\n| task | deja | passed | mean cost | mean input tokens | mean turns |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.task} | ${r.arm} | ${r.passed} | $${fmt(r.cost, 4)} | ${fmt(r.input)} | ${fmt(r.turns, 1)} |`);
  }
}

const flags = parseFlags(process.argv.slice(2));
if (!existsSync(cli)) {
  console.error("dist/cli.js is missing: run `npm run build` first.");
  process.exit(1);
}
const names = readdirSync(tasksDir).filter((n) => !flags.task || n === flags.task);
if (names.length === 0) {
  console.error(`no task named ${flags.task} in bench/tasks`);
  process.exit(1);
}

const runs = [];
for (const name of names) {
  const task = JSON.parse(readFileSync(join(tasksDir, name, "task.json"), "utf8"));
  for (let i = 0; i < flags.runs; i++) {
    // Alternate which arm goes first, so neither always meets a cold cache.
    const arms = i % 2 === 0 ? ["off", "on"] : ["on", "off"];
    for (const arm of arms) {
      const { run, work, home } = runOnce(name, task, arm, flags.model);
      runs.push(run);
      console.log(`${name} · deja ${arm} · run ${i + 1}: ${run.pass ? "pass" : "FAIL"} · $${fmt(run.costUsd, 4)} · ${run.turns ?? "?"} turns${run.pass ? "" : ` · ${run.check || run.stderr || "no result"}`}`);
      if (!flags.keep) {
        rmSync(work, { recursive: true, force: true });
        delete run.workDir;
      }
      rmSync(home, { recursive: true, force: true });
    }
  }
}

summarize(runs);
writeFileSync(flags.out, JSON.stringify({ model: flags.model, runs }, null, 2));
console.log(`\nAll runs written to ${flags.out}.`);

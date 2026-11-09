import { writeFileSync } from "node:fs";
import { join } from "node:path";

const L = (o: object) => JSON.stringify(o);

/** Write a small but real-looking transcript with a repeated read. */
export function writeTranscript(dir: string, name: string): string {
  const file = Array.from({ length: 60 }, (_, i) => `${String(i + 1).padStart(6)}\texport const value${i} = compute(${i}, "x");`).join("\n");
  const lines = [L({ type: "user", cwd: "/repo", sessionId: name, timestamp: "2026-11-01T10:00:00Z", message: { role: "user", content: "go" } })];
  for (let k = 0; k < 3; k++) {
    lines.push(
      L({
        type: "assistant",
        timestamp: `2026-11-01T10:0${k}:10Z`,
        message: { id: `m${k}`, role: "assistant", model: "claude-sonnet-4-5", content: [{ type: "tool_use", id: `t${k}`, name: "Read", input: { file_path: "/repo/a.ts" } }] },
      }),
      L({ type: "user", timestamp: `2026-11-01T10:0${k}:20Z`, message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${k}`, content: file }] } }),
    );
  }
  lines.push(L({ type: "assistant", timestamp: "2026-11-01T10:05:00Z", message: { id: "end", role: "assistant", content: [{ type: "text", text: "done" }] } }));
  const path = join(dir, `${name}.jsonl`);
  writeFileSync(path, lines.join("\n"));
  return path;
}

/** Write a small Codex CLI rollout with a repeated `cat` of the same file. */
export function writeCodexRollout(dir: string, name: string): string {
  const file = Array.from({ length: 60 }, (_, i) => `export const value${i} = compute(${i}, "x");`).join("\n");
  const lines = [
    L({ timestamp: "2026-11-01T10:00:00Z", type: "session_meta", payload: { id: name, cwd: "/repo" } }),
    L({ timestamp: "2026-11-01T10:00:00Z", type: "turn_context", payload: { cwd: "/repo", model: "gpt-5-codex" } }),
    L({ timestamp: "2026-11-01T10:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] } }),
  ];
  for (let k = 0; k < 3; k++) {
    lines.push(
      L({ timestamp: `2026-11-01T10:0${k + 1}:00Z`, type: "response_item", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["cat", "a.ts"] }), call_id: `c${k}` } }),
      L({ timestamp: `2026-11-01T10:0${k + 1}:01Z`, type: "response_item", payload: { type: "function_call_output", call_id: `c${k}`, output: file } }),
    );
  }
  lines.push(L({ timestamp: "2026-11-01T10:05:00Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } }));
  const path = join(dir, `rollout-${name}.jsonl`);
  writeFileSync(path, lines.join("\n"));
  return path;
}

import { splitLines, type Line } from "../core/lines.js";
import { estimateTokens, formatTokens } from "../core/tokens.js";

/**
 * Stubs replace content that has gone stale. They keep just enough for the
 * model to remember what happened and tell it how to get the rest back:
 * tool outputs can be re-materialised from the environment.
 *
 *  - file reads keep an outline: declarations with their line numbers, so
 *    the model can re-read exactly the range it needs
 *  - command output keeps its first lines, its last lines (where commands
 *    print their verdict) and any salient lines in between (errors,
 *    failures, test summaries)
 */

const HEAD = 2;
const TAIL = 3;
const MAX_SALIENT = 6;
const MAX_OUTLINE = 14;
const WIDTH = 160;

export const STUB_MARK = "⟪deja: stale";

/** Tools whose results are file contents. */
const READ_TOOLS = new Set(["Read", "read_file", "view", "view_file", "open_file", "readFile", "cat"]);

const SALIENT = /\b(error|errors|fail|failed|failure|failing|panic|exception|traceback|fatal|warning|warn|denied|not found|passed|tests?:|test files|✗|✘|×)\b|^(FAIL|ERROR|E\s)/i;

const DECLARATION =
  /^\s*(export\s+)?(default\s+)?(async\s+)?(pub(\(crate\))?\s+)?(public\s+|private\s+|protected\s+|static\s+)*(function|class|interface|type|enum|struct|impl|trait|fn|func|def|module|namespace|const\s+\w+\s*=\s*(async\s*)?\(|let\s+\w+\s*=\s*(async\s*)?\()\b/;

function clip(s: string): string {
  return s.length > WIDTH ? `${s.slice(0, WIDTH - 1)}…` : s;
}

/** First and last lines, plus salient lines in between, in original order. */
export function preview(text: string): string[] {
  const lines = splitLines(text).map((l) => l.raw);
  if (lines.length <= HEAD + TAIL + 1) return lines.map(clip);
  const keep = new Set<number>();
  for (let i = 0; i < HEAD; i++) keep.add(i);
  for (let i = lines.length - TAIL; i < lines.length; i++) keep.add(i);
  let salient = 0;
  for (let i = HEAD; i < lines.length - TAIL && salient < MAX_SALIENT; i++) {
    if (SALIENT.test(lines[i]!)) {
      keep.add(i);
      salient++;
    }
  }
  const out: string[] = [];
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > prev + 1) out.push("…");
    out.push(clip(lines[i]!));
    prev = i;
  }
  return out;
}

/** Declarations with line numbers, e.g. `  42: export function parse(`. */
export function outline(text: string): string[] {
  const lines: Line[] = splitLines(text);
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (out.length >= MAX_OUTLINE) return;
    if (DECLARATION.test(l.body)) out.push(`${String(l.num ?? i + 1).padStart(5)}: ${clip(l.body.trim())}`);
  });
  return out;
}

export function resultStub(label: string, text: string, tool?: string): string {
  const lines = splitLines(text).length;
  const size = `${lines} lines, ~${formatTokens(estimateTokens(text))} tokens`;
  if (tool && READ_TOOLS.has(tool)) {
    const decls = outline(text);
    const head =
      `${STUB_MARK} contents of ${label} (${size}) removed from context after they went unused. ` +
      `Read the file again for the lines you need.${decls.length ? " Outline:" : ""}⟫`;
    return [head, ...decls].join("\n");
  }
  const head = `${STUB_MARK} output of ${label} (${size}) removed from context after it went unused. Run the tool again if you need it.⟫`;
  return [head, ...preview(text)].join("\n");
}

export function inputStub(label: string, text: string): string {
  const lines = splitLines(text).length;
  return `${STUB_MARK}: ${lines} lines you wrote with ${label} were removed from context. Read the file for its current contents.⟫`;
}

export function isStub(text: string): boolean {
  return text.startsWith(STUB_MARK);
}

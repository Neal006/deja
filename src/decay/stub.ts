import { splitLines } from "../core/lines.js";
import { estimateTokens, formatTokens } from "../core/tokens.js";

/**
 * Stubs replace content that has gone stale. They keep just enough for the
 * model to remember what happened (the first and last lines, where commands
 * print their headline and their verdict) and tell it how to get the rest
 * back: tool outputs can be re-materialised from the environment.
 */

const PREVIEW_HEAD = 2;
const PREVIEW_TAIL = 3;
const PREVIEW_WIDTH = 160;

export const STUB_MARK = "⟪deja: stale";

function clip(s: string): string {
  return s.length > PREVIEW_WIDTH ? `${s.slice(0, PREVIEW_WIDTH - 1)}…` : s;
}

export function preview(text: string): string[] {
  const lines = splitLines(text).map((l) => l.raw);
  if (lines.length <= PREVIEW_HEAD + PREVIEW_TAIL + 1) return lines.map(clip);
  return [...lines.slice(0, PREVIEW_HEAD).map(clip), "…", ...lines.slice(-PREVIEW_TAIL).map(clip)];
}

export function resultStub(label: string, text: string): string {
  const lines = splitLines(text).length;
  const head =
    `${STUB_MARK} output of ${label} (${lines} lines, ~${formatTokens(estimateTokens(text))} tokens) ` +
    `removed from context after it went unused. Run the tool again if you need it.⟫`;
  return [head, ...preview(text)].join("\n");
}

export function inputStub(label: string, text: string): string {
  const lines = splitLines(text).length;
  return `${STUB_MARK}: ${lines} lines you wrote with ${label} were removed from context. Read the file for its current contents.⟫`;
}

export function isStub(text: string): boolean {
  return text.startsWith(STUB_MARK);
}

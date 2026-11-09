import { compressText, DEFAULT_COMPRESS, type CompressOptions } from "../core/compress.js";
import { Dictionary, literalSource } from "../core/dictionary.js";
import { findCwd, LabelRegistry, toolLabel } from "../core/labels.js";
import { isNumbered, splitLines } from "../core/lines.js";
import type { ContentBlock, Message, MessagesRequest, TextBlock, ToolResultBlock, ToolUseBlock } from "./types.js";

/** Tools whose input contains the full text of a file the model just wrote. */
const WRITE_TOOLS = new Set(["Write", "write_file", "create_file", "write_to_file"]);
const WRITE_CONTENT_KEYS = ["content", "file_text", "contents"];

export interface TransformStats {
  toolResults: number;
  compressed: number;
  tokensBefore: number;
  tokensAfter: number;
}

export interface TransformResult {
  body: MessagesRequest;
  changed: boolean;
  stats: TransformStats;
}

export interface TransformOptions {
  compress?: CompressOptions;
  /** Tool names never to compress, e.g. tools returning secrets or binary-ish data. */
  skipTools?: string[];
}

function systemText(system: MessagesRequest["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((b) => (typeof b.text === "string" ? b.text : "")).join("\n");
}

/**
 * Rewrite tool results in a Messages API request so that content already
 * visible earlier in the conversation is replaced with short references.
 *
 * The rewrite of message `k` depends only on messages `0..k`. Earlier
 * messages are therefore rewritten identically on every request, which keeps
 * the provider's prompt cache prefix stable.
 */
export function transformRequest(body: MessagesRequest, options: TransformOptions = {}): TransformResult {
  const opts = options.compress ?? DEFAULT_COMPRESS;
  const skip = new Set(options.skipTools ?? []);
  const cwd = findCwd(systemText(body.system));
  const dict = new Dictionary();
  const labels = new LabelRegistry();
  const uses = new Map<string, ToolUseBlock>();
  const stats: TransformStats = { toolResults: 0, compressed: 0, tokensBefore: 0, tokensAfter: 0 };
  let changed = false;

  const messages = body.messages.map((msg): Message => {
    if (typeof msg.content === "string") return msg;
    let msgChanged = false;
    const content = msg.content.map((block): ContentBlock => {
      if (block.type === "tool_use") {
        const use = block as ToolUseBlock;
        uses.set(use.id, use);
        indexWrite(use, dict, labels, cwd);
        return block;
      }
      if (block.type !== "tool_result") return block;
      const result = block as ToolResultBlock;
      const use = uses.get(result.tool_use_id);
      const name = use?.name ?? "tool";
      const label = labels.next(toolLabel(name, use?.input, cwd));
      stats.toolResults++;
      const compressible = !result.is_error && !skip.has(name);
      const next = rewriteResult(result, label, dict, opts, compressible, stats);
      if (next !== result) msgChanged = true;
      return next;
    });
    if (!msgChanged) return msg;
    changed = true;
    return { ...msg, content };
  });

  return { body: changed ? { ...body, messages } : body, changed, stats };
}

function indexWrite(use: ToolUseBlock, dict: Dictionary, labels: LabelRegistry, cwd: string | undefined): void {
  if (!WRITE_TOOLS.has(use.name)) return;
  const input = use.input ?? {};
  const text = WRITE_CONTENT_KEYS.map((k) => input[k]).find((v): v is string => typeof v === "string");
  if (!text) return;
  const lines = splitLines(text);
  const label = `your ${labels.next(toolLabel(use.name, input, cwd))}`;
  dict.add(literalSource(use.id, label, lines, isNumbered(lines)));
}

function rewriteResult(
  result: ToolResultBlock,
  label: string,
  dict: Dictionary,
  opts: CompressOptions,
  compressible: boolean,
  stats: TransformStats,
): ToolResultBlock {
  const apply = (text: string, id: string): string => {
    if (!compressible) {
      const lines = splitLines(text);
      dict.add(literalSource(id, label, lines, isNumbered(lines)));
      return text;
    }
    const r = compressText(id, label, text, dict, opts);
    dict.add(r.source);
    stats.tokensBefore += r.tokensBefore;
    stats.tokensAfter += r.tokensAfter;
    if (r.changed) stats.compressed++;
    return r.text;
  };

  const content = result.content;
  if (typeof content === "string") {
    const text = apply(content, result.tool_use_id);
    return text === content ? result : { ...result, content: text };
  }
  if (!Array.isArray(content)) return result;

  let blockChanged = false;
  const blocks = content.map((b, i) => {
    if (b.type !== "text" || typeof (b as TextBlock).text !== "string") return b;
    const tb = b as TextBlock;
    const text = apply(tb.text, `${result.tool_use_id}#${i}`);
    if (text === tb.text) return b;
    blockChanged = true;
    return { ...tb, text };
  });
  return blockChanged ? { ...result, content: blocks } : result;
}

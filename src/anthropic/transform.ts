import { compressText, DEFAULT_COMPRESS, type CompressOptions } from "../core/compress.js";
import { Dictionary, literalSource } from "../core/dictionary.js";
import { findCwd, LabelRegistry, toolLabel } from "../core/labels.js";
import { isNumbered, splitLines } from "../core/lines.js";
import { estimateTokens } from "../core/tokens.js";
import { inputStub, resultStub } from "../decay/stub.js";
import { FILE_INPUT_TOOLS, mapLongStrings, WRITE_CONTENT_KEYS, WRITE_TOOLS } from "./tools.js";
import type { ContentBlock, Message, MessagesRequest, TextBlock, ToolResultBlock, ToolUseBlock } from "./types.js";

export interface TransformStats {
  toolResults: number;
  compressed: number;
  tokensBefore: number;
  tokensAfter: number;
  /**
   * Tokens saved in the final message only. That message is new on this
   * request, so it would have been billed at full (or cache-write) price;
   * savings in earlier messages would mostly have been cheap cache reads.
   */
  freshSaved: number;
  /** Tool results replaced by decay stubs. */
  evictedResults: number;
  /** Write/edit inputs whose bodies were replaced by decay stubs. */
  evictedInputs: number;
}

export interface TransformResult {
  body: MessagesRequest;
  changed: boolean;
  stats: TransformStats;
  /** Estimated tokens saved in each message, aligned with `body.messages`. */
  savedByMessage: number[];
  /** Estimated original tool-result tokens in each message. */
  toolTokensByMessage: number[];
}

export interface TransformOptions {
  compress?: CompressOptions;
  /** Tool names never to compress, e.g. tools returning secrets or binary-ish data. */
  skipTools?: string[];
  /** Observe every tool result as it is processed (used by `deja audit`). */
  onResult?: (info: ResultInfo) => void;
  /**
   * tool_use ids whose content has gone stale and should be replaced by a
   * stub: the tool result, and for write/edit tools also the input body.
   * Chosen by the decay policy; empty means dedup only.
   */
  evict?: ReadonlySet<string>;
}

export interface ResultInfo {
  /** Tool name, e.g. `Read`. */
  tool: string;
  /** Label without the repeat ordinal, e.g. `Read src/a.ts`. */
  target: string;
  messageIndex: number;
  tokensBefore: number;
  tokensAfter: number;
}

function systemText(system: MessagesRequest["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((b) => (typeof b.text === "string" ? b.text : "")).join("\n");
}

/**
 * The rewrite engine, one message at a time.
 *
 * Holds everything the rewrite of later messages depends on (the dictionary
 * of visible lines, label numbering, tool calls seen so far). Pushing the
 * messages of a conversation in order yields the same output as
 * `transformRequest`; keeping an engine alive lets a caller process only
 * the messages a new request adds.
 */
export class TransformEngine {
  readonly stats: TransformStats = {
    toolResults: 0,
    compressed: 0,
    tokensBefore: 0,
    tokensAfter: 0,
    freshSaved: 0,
    evictedResults: 0,
    evictedInputs: 0,
  };
  readonly savedByMessage: number[] = [];
  readonly toolTokensByMessage: number[] = [];
  /** Rewritten messages so far, aligned with the pushed messages. */
  readonly output: Message[] = [];
  /** Whether any pushed message was rewritten. */
  changed = false;

  private readonly opts: CompressOptions;
  private readonly skip: Set<string>;
  private readonly cwd: string | undefined;
  private readonly evict: ReadonlySet<string>;
  private readonly dict = new Dictionary();
  private readonly labels = new LabelRegistry();
  private readonly uses = new Map<string, ToolUseBlock>();

  constructor(
    system: MessagesRequest["system"],
    private readonly options: TransformOptions = {},
  ) {
    this.opts = options.compress ?? DEFAULT_COMPRESS;
    this.skip = new Set(options.skipTools ?? []);
    this.cwd = findCwd(systemText(system));
    this.evict = options.evict ?? new Set<string>();
  }

  /** Rewrite the next message of the conversation. */
  push(msg: Message): Message {
    const idx = this.output.length;
    const out = this.rewrite(msg, idx);
    this.output.push(out);
    if (out !== msg) this.changed = true;
    this.stats.freshSaved = this.savedByMessage[idx] ?? 0;
    return out;
  }

  private rewrite(msg: Message, idx: number): Message {
    const stats = this.stats;
    if (typeof msg.content === "string") {
      this.savedByMessage.push(0);
      this.toolTokensByMessage.push(0);
      return msg;
    }
    const savedBefore = stats.tokensBefore - stats.tokensAfter;
    const toolBefore = stats.tokensBefore;
    let msgChanged = false;
    const content = msg.content.map((block): ContentBlock => {
      if (block.type === "tool_use") {
        const use = block as ToolUseBlock;
        this.uses.set(use.id, use);
        if (this.evict.has(use.id) && FILE_INPUT_TOOLS.has(use.name)) {
          const stubbed = evictInput(use, this.labels, this.cwd, stats);
          if (stubbed !== use) msgChanged = true;
          return stubbed;
        }
        indexWrite(use, this.dict, this.labels, this.cwd);
        return block;
      }
      if (block.type !== "tool_result") return block;
      const result = block as ToolResultBlock;
      const use = this.uses.get(result.tool_use_id);
      const name = use?.name ?? "tool";
      const target = toolLabel(name, use?.input, this.cwd);
      const label = this.labels.next(target);
      stats.toolResults++;
      const compressible = !result.is_error && !this.skip.has(name);
      const before = stats.tokensBefore;
      const after = stats.tokensAfter;
      const next = this.evict.has(result.tool_use_id)
        ? evictResult(result, label, name, stats)
        : rewriteResult(result, label, this.dict, this.opts, compressible, stats);
      this.options.onResult?.({
        tool: name,
        target,
        messageIndex: idx,
        tokensBefore: stats.tokensBefore - before,
        tokensAfter: stats.tokensAfter - after,
      });
      if (next !== result) msgChanged = true;
      return next;
    });
    this.savedByMessage.push(stats.tokensBefore - stats.tokensAfter - savedBefore);
    this.toolTokensByMessage.push(stats.tokensBefore - toolBefore);
    return msgChanged ? { ...msg, content } : msg;
  }

  /** A TransformResult for `body`, whose messages must all have been pushed. */
  result(body: MessagesRequest): TransformResult {
    return {
      body: this.changed ? { ...body, messages: [...this.output] } : body,
      changed: this.changed,
      stats: { ...this.stats },
      savedByMessage: [...this.savedByMessage],
      toolTokensByMessage: [...this.toolTokensByMessage],
    };
  }
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
  const engine = new TransformEngine(body.system, options);
  for (const msg of body.messages) engine.push(msg);
  return engine.result(body);
}

function resultText(result: ToolResultBlock): string {
  const c = result.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.map((b) => (b.type === "text" && typeof (b as TextBlock).text === "string" ? (b as TextBlock).text : "")).join("\n");
}

/** Replace a stale tool result with a stub. Stubs are never indexed. */
function evictResult(result: ToolResultBlock, label: string, tool: string, stats: TransformStats): ToolResultBlock {
  const text = resultText(result);
  const stub = resultStub(label, text, tool);
  const before = estimateTokens(text);
  const after = estimateTokens(stub);
  if (after >= before) return result;
  stats.tokensBefore += before;
  stats.tokensAfter += after;
  stats.evictedResults++;
  if (Array.isArray(result.content)) {
    // Keep the array form, and any cache breakpoint the client put on a
    // block, so eviction never silently moves the client's cache markers.
    const marker = [...result.content].reverse().find((b) => "cache_control" in b) as { cache_control?: unknown } | undefined;
    const block: TextBlock = { type: "text", text: stub, ...(marker ? { cache_control: marker.cache_control } : {}) };
    return { ...result, content: [block] };
  }
  return { ...result, content: stub };
}

/** Replace the long strings of a stale write/edit input with stubs. */
function evictInput(use: ToolUseBlock, labels: LabelRegistry, cwd: string | undefined, stats: TransformStats): ToolUseBlock {
  // Consume a label slot so later labels match the non-evicted numbering.
  const label = WRITE_TOOLS.has(use.name) ? labels.next(toolLabel(use.name, use.input, cwd)) : toolLabel(use.name, use.input, cwd);
  let before = 0;
  let after = 0;
  const input = mapLongStrings(use.input ?? {}, (s) => {
    const stub = inputStub(label, s);
    before += estimateTokens(s);
    after += estimateTokens(stub);
    return stub;
  }) as Record<string, unknown>;
  if (before === 0) return use;
  stats.tokensBefore += before;
  stats.tokensAfter += after;
  stats.evictedInputs++;
  return { ...use, input };
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

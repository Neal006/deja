import { FILE_INPUT_TOOLS, longStringChars } from "../anthropic/tools.js";
import type { ContentBlock, Message, MessagesRequest, TextBlock, ToolResultBlock, ToolUseBlock } from "../anthropic/types.js";
import { estimateTokens } from "../core/tokens.js";

/**
 * What a request is made of, from the decay policy's point of view: how big
 * each message is, and which pieces of content could be stubbed.
 */

/** Approximate size of a stub, in tokens. */
export const RESULT_STUB_TOKENS = 70;
export const INPUT_STUB_TOKENS = 30;

export interface Item {
  /** The tool_use id the content belongs to. */
  id: string;
  kind: "result" | "input";
  messageIndex: number;
  /** Requests that have carried this item since it appeared. */
  age: number;
  /** Tokens we would save by stubbing it. */
  saving: number;
}

export interface Inventory {
  items: Item[];
  /** Estimated tokens per message, aligned with `messages`. */
  messageTokens: number[];
  /** First tool_use id in the conversation: a stable conversation key. */
  key?: string;
}

function blockText(b: ContentBlock): string {
  switch (b.type) {
    case "text":
      return typeof (b as TextBlock).text === "string" ? (b as TextBlock).text : "";
    case "tool_use":
      return JSON.stringify((b as ToolUseBlock).input ?? {});
    case "tool_result": {
      const c = (b as ToolResultBlock).content;
      if (typeof c === "string") return c;
      if (!Array.isArray(c)) return "";
      return c.map((x) => (x.type === "text" ? String((x as TextBlock).text ?? "") : "")).join("\n");
    }
    default:
      // Thinking from earlier turns is dropped by the API; images are opaque.
      return "";
  }
}

/** Estimated tokens of one message as the model would see it. */
export function messageTokens(msg: Message): number {
  if (typeof msg.content === "string") return estimateTokens(msg.content);
  let n = 0;
  for (const b of msg.content) n += estimateTokens(blockText(b));
  return n;
}

export function takeInventory(body: MessagesRequest): Inventory {
  const msgs = body.messages;
  const messageTokens: number[] = [];
  const items: Item[] = [];
  const names = new Map<string, string>();
  let key: string | undefined;

  // Age = number of assistant messages after the item, i.e. how many
  // requests have already carried it.
  const assistantsAfter = new Array<number>(msgs.length).fill(0);
  let count = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    assistantsAfter[i] = count;
    if (msgs[i]!.role === "assistant") count++;
  }

  msgs.forEach((msg, i) => {
    if (typeof msg.content === "string") {
      messageTokens.push(estimateTokens(msg.content));
      return;
    }
    let tokens = 0;
    for (const b of msg.content) {
      const text = blockText(b);
      const t = estimateTokens(text);
      tokens += t;
      if (b.type === "tool_use") {
        const use = b as ToolUseBlock;
        key ??= use.id;
        names.set(use.id, use.name);
        if (FILE_INPUT_TOOLS.has(use.name)) {
          const chars = longStringChars(use.input ?? {});
          const saving = Math.round(chars / 4) - INPUT_STUB_TOKENS;
          if (saving > 0) items.push({ id: use.id, kind: "input", messageIndex: i, age: assistantsAfter[i]!, saving });
        }
      } else if (b.type === "tool_result") {
        const r = b as ToolResultBlock;
        if (r.is_error) continue;
        const saving = t - RESULT_STUB_TOKENS;
        if (saving > 0) items.push({ id: r.tool_use_id, kind: "result", messageIndex: i, age: assistantsAfter[i]!, saving });
      }
    }
    messageTokens.push(tokens);
  });
  return { items, messageTokens, key };
}

/** Prompt-cache TTL the client asked for, in ms (Anthropic: 5 min or 1 h). */
export function cacheTtlMs(body: MessagesRequest): number {
  const json = JSON.stringify(body.system ?? "") + JSON.stringify(body.messages.slice(-4));
  return /"ttl"\s*:\s*"1h"/.test(json) ? 3_600_000 : 300_000;
}

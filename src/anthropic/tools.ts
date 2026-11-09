/**
 * Knowledge about common agent tools, shared by dedup and decay.
 * Names cover Claude Code plus a few popular open-source agents.
 */

/** Tools whose input carries the full text of a file being written. */
export const WRITE_TOOLS = new Set(["Write", "write_file", "create_file", "write_to_file"]);

/** Keys holding written file content in those tools. */
export const WRITE_CONTENT_KEYS = ["content", "file_text", "contents"];

/** Tools whose input carries large file fragments (writes and edits). */
export const FILE_INPUT_TOOLS = new Set([
  ...WRITE_TOOLS,
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "str_replace_editor",
  "str_replace_based_edit_tool",
  "edit_file",
  "replace_in_file",
  "apply_patch",
]);

/** Input keys that identify *where* a write goes; never stubbed. */
export const IDENTITY_KEYS = new Set(["file_path", "path", "filePath", "target_file", "notebook_path", "command", "cell_id"]);

/** Strings shorter than this are not worth stubbing. */
export const MIN_STUB_CHARS = 200;

/**
 * Return a copy of a tool input with every long string replaced by
 * `replace(value)`, preserving the structure and value types, so the
 * history still matches the tool's schema.
 */
export function mapLongStrings(value: unknown, replace: (s: string) => string, key?: string): unknown {
  if (typeof value === "string") {
    if (key !== undefined && IDENTITY_KEYS.has(key)) return value;
    return value.length >= MIN_STUB_CHARS ? replace(value) : value;
  }
  if (Array.isArray(value)) return value.map((v) => mapLongStrings(v, replace));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapLongStrings(v, replace, k);
    return out;
  }
  return value;
}

/** Total characters in long, stubbable strings of a tool input. */
export function longStringChars(value: unknown, key?: string): number {
  if (typeof value === "string") {
    if (key !== undefined && IDENTITY_KEYS.has(key)) return 0;
    return value.length >= MIN_STUB_CHARS ? value.length : 0;
  }
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + longStringChars(v), 0);
  if (value && typeof value === "object") {
    let n = 0;
    for (const [k, v] of Object.entries(value)) n += longStringChars(v, k);
    return n;
  }
  return 0;
}

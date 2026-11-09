import type { ParsedArgs } from "../args.js";

/** Subcommands and their flags, the single source for completions. */
export const COMMANDS: Record<string, string[]> = {
  audit: ["--since", "--project", "--dir", "--limit", "--min-age", "--uncached", "--quick", "--share", "--by-project", "--tune", "--no-calibrate", "--agent", "--json", "--jobs", "--model", "--top", "--no-color"],
  preview: ["--request", "--segment", "--min-age", "--no-decay", "--json", "--no-color"],
  claude: ["--upstream", "--off", "--no-decay", "--min-age", "--min-saving", "--uncached", "--skip-tools", "--quiet"],
  run: ["--openai", "--upstream", "--off", "--no-decay", "--min-age", "--min-saving", "--uncached", "--skip-tools", "--quiet"],
  start: ["--port", "--upstream", "--off", "--no-decay", "--min-age", "--min-saving", "--uncached", "--skip-tools", "--quiet", "--log"],
  stats: ["--since", "--json", "--by-model", "--reset", "--no-color"],
  doctor: ["--upstream", "--offline"],
  statusline: [],
  setup: ["statusline", "--force"],
  completion: ["bash", "zsh", "fish"],
  help: [],
};

export function bashCompletion(): string {
  const cases = Object.entries(COMMANDS)
    .map(([cmd, flags]) => `    ${cmd}) opts="${flags.join(" ")}" ;;`)
    .join("\n");
  return `# deja bash completion: eval "$(deja completion bash)"
_deja() {
  local cur cmd opts
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${Object.keys(COMMANDS).join(" ")}" -- "$cur") )
    return
  fi
  case "$cmd" in
${cases}
    *) opts="" ;;
  esac
  COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
}
complete -F _deja deja
`;
}

export function zshCompletion(): string {
  const cases = Object.entries(COMMANDS)
    .map(([cmd, flags]) => `    ${cmd}) compadd -- ${flags.join(" ")} ;;`)
    .join("\n");
  return `#compdef deja
# deja zsh completion: eval "$(deja completion zsh)"
_deja() {
  if (( CURRENT == 2 )); then
    compadd -- ${Object.keys(COMMANDS).join(" ")}
    return
  fi
  case "\${words[2]}" in
${cases}
  esac
}
compdef _deja deja
`;
}

export function fishCompletion(): string {
  const lines = ["# deja fish completion: deja completion fish | source"];
  lines.push(`complete -c deja -f -n "__fish_use_subcommand" -a "${Object.keys(COMMANDS).join(" ")}"`);
  for (const [cmd, flags] of Object.entries(COMMANDS)) {
    for (const f of flags) {
      lines.push(
        f.startsWith("--")
          ? `complete -c deja -f -n "__fish_seen_subcommand_from ${cmd}" -l ${f.slice(2)}`
          : `complete -c deja -f -n "__fish_seen_subcommand_from ${cmd}" -a ${f}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function completionCommand(args: ParsedArgs): number {
  const shell = args.positionals[0];
  const script = shell === "bash" ? bashCompletion() : shell === "zsh" ? zshCompletion() : shell === "fish" ? fishCompletion() : undefined;
  if (!script) {
    process.stderr.write("usage: deja completion bash|zsh|fish\n");
    return 2;
  }
  process.stdout.write(script);
  return 0;
}

# Examples

| file | what it shows |
|---|---|
| [anthropic-sdk.ts](anthropic-sdk.ts) | `dejaFetch` in an Anthropic SDK agent |
| [openai-sdk.ts](openai-sdk.ts) | `dejaFetch` with the OpenAI SDK, OpenRouter or local models |
| [agent-sdk.ts](agent-sdk.ts) | the Claude Agent SDK through an in-process deja proxy |

## Run them

The examples use your local checkout of deja, so build it first:

```bash
npm install && npm run build      # in the repo root
cd examples && npm install
npm run anthropic                 # or: npm run openai, npm run agent-sdk
```

Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` for the OpenAI example) first. In your own project, install from npm instead: `npm i dejactx` plus the SDK you use.

For Claude Code, Codex, aider and other CLI agents you don't need code: use `npx dejactx claude` or `npx dejactx run [--openai] -- <agent>`.

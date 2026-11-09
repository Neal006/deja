/**
 * deja with the Claude Agent SDK.
 *
 * The Agent SDK runs Claude Code under the hood, which honours
 * ANTHROPIC_BASE_URL. Start a proxy, point the SDK at it, and every turn of
 * your agent goes through deja.
 *
 *   npm i @anthropic-ai/claude-agent-sdk dejactx
 *   npx tsx examples/agent-sdk.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createProxy } from "dejactx";
import type { AddressInfo } from "node:net";

const proxy = createProxy({
  onRequest: (e) => console.error(`deja: ${e.stats.tokensBefore - e.stats.tokensAfter} tokens not resent`),
});
await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const { port } = proxy.address() as AddressInfo;

for await (const message of query({
  prompt: "List the files in this directory and summarise what the project does.",
  options: { env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` } },
})) {
  if (message.type === "result") console.log(message);
}

proxy.close();

/**
 * deja inside an agent built on the Anthropic SDK.
 *
 *   npm i @anthropic-ai/sdk dejactx
 *   npx tsx examples/anthropic-sdk.ts      (with your API key in the environment)
 */
import Anthropic from "@anthropic-ai/sdk";
import { dejaFetch } from "dejactx";

const client = new Anthropic({
  fetch: dejaFetch({
    // Log what deja did to each request.
    onRequest: (e) => console.error(`deja: ${e.stats.tokensBefore - e.stats.tokensAfter} tokens trimmed`),
  }),
});

const reply = await client.messages.create({
  model: "claude-haiku-4-5",
  max_tokens: 256,
  messages: [{ role: "user", content: "Say hello in five words." }],
});
console.log(reply.content);

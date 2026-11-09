/**
 * deja inside an agent built on the OpenAI SDK (Chat Completions or
 * Responses), or any OpenAI-compatible endpoint such as OpenRouter.
 *
 *   npm i openai dejactx
 *   npx tsx examples/openai-sdk.ts      (with your API key in the environment)
 */
import OpenAI from "openai";
import { DEFAULT_DECAY, dejaFetch } from "dejactx";

// Local models have no prompt cache: let deja evict stale output eagerly.
const uncached = process.env.OPENAI_BASE_URL?.includes("localhost") ?? false;

const client = new OpenAI({
  fetch: dejaFetch({ decayConfig: { ...DEFAULT_DECAY, writeMultiplier: 1, uncached } }),
});

const reply = await client.chat.completions.create({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Say hello in five words." }],
});
console.log(reply.choices[0]?.message.content);

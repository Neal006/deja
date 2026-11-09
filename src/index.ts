/**
 * deja as a library.
 *
 * Most people run the CLI (`npx dejactx claude`). These exports are for
 * embedding deja in your own agent, gateway or tooling.
 */

// In-process: wrap an SDK's fetch.
export { dejaFetch, type DejaFetchOptions } from "./fetch.js";

// The proxy.
export { createProxy, rewriteBody, apiKind, type ProxyOptions, type ProxyEvent, type DecayOptions } from "./proxy/server.js";

// The engines.
export { transformRequest, type TransformOptions, type TransformResult, type TransformStats } from "./anthropic/transform.js";
export { transformChatRequest } from "./openai/adapter.js";
export { transformResponsesRequest } from "./openai/responses.js";
export { compressText, DEFAULT_COMPRESS, type CompressOptions, type CompressResult } from "./core/compress.js";
export { decide, freshState, DEFAULT_DECAY, type DecayConfig, type ConversationState, type DecayDecision } from "./decay/policy.js";
export { StateStore } from "./decay/store.js";

// Measurement.
export { CacheBiller, DEFAULT_BILLING, type Bill, type BillingConfig } from "./audit/billing.js";
export { replaySegment, replayAll, STRATEGIES, type Strategy } from "./audit/replay.js";
export { parseTranscript, readTranscript, type Transcript } from "./audit/transcript.js";
export { estimateTokens } from "./core/tokens.js";

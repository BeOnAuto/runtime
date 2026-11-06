import type { Environment } from '../settings/setting-values.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { jsonResponse, recordingFetch } from './recording-fetch.ts';

export const gatewayModel = 'internal/llama-3.3-70b';

const internal = { name: 'internal', base_url: 'https://llm.internal.example/v1', cost_header: 'X-Call-Cost' };

export const describingGateway: Environment = { MODEL_GATEWAYS: JSON.stringify([internal]) };

export const enforcingGateway: Environment = {
  MODEL_GATEWAYS: JSON.stringify([{ ...internal, structured_outputs: true }]),
};

export const usageOfOneAnswer = {
  input: { total: 19, uncached: 16, cache_read: 3, cache_write: null },
  output: { total: 10, text: 10, reasoning: 0 },
  total: 29,
};

export const usageOfTwoAnswers = {
  input: { total: 38, uncached: 32, cache_read: 6, cache_write: null },
  output: { total: 20, text: 20, reasoning: 0 },
  total: 58,
};

export type BeforeTheAnswer = () => void;

export async function answersInTurn(environment: Environment, ...replies: readonly object[]) {
  const beforeTheAnswers: BeforeTheAnswer[] = [];
  const recording = recordingFetch((_request, attempt) => {
    beforeTheAnswers.shift()?.();
    return jsonResponse(replies[Math.min(attempt, replies.length) - 1], 200, { 'x-call-cost': '0.25' });
  });
  const access = await accessFor(environment, { fetch: recording.fetch });
  return {
    access,
    requests: recording.requests,
    before: (happening: BeforeTheAnswer) => {
      beforeTheAnswers.push(happening);
    },
  };
}

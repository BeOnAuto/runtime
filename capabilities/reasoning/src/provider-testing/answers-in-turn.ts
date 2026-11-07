import { Array as Arr } from 'effect';

import type { Environment } from '../settings/setting-values.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { recordingReporter } from './provider-errors.ts';
import { chatCompletion } from './provider-replies.ts';
import { jsonResponse, recordingFetch, type Responder } from './recording-fetch.ts';

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

export function answeredWith(text: string): Responder {
  return () => jsonResponse(chatCompletion(text), 200, { 'x-call-cost': '0.25' });
}

export function refusedByTheGateway(status: number, code: string | null = String(status)): Responder {
  const message = "litellm.BadRequestError: OpenAIException - Invalid schema for response_format 'verdict'";
  return () => jsonResponse({ error: { message, type: null, param: null, code } }, status);
}

export async function respondedInTurn(environment: Environment, ...replies: readonly Responder[]) {
  const reporter = recordingReporter();
  const recording = recordingFetch((request, attempt) =>
    Arr.getUnsafe(replies, Math.min(attempt, replies.length) - 1)(request, attempt),
  );
  const access = await accessFor(environment, { fetch: recording.fetch, reportProviderMessage: reporter.report });
  return { access, requests: recording.requests, reports: reporter.reports };
}

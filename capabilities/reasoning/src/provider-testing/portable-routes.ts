import type { ModelResult } from '../model/model-result.ts';
import { writtenSamples } from '../schema-testing/answer-samples.ts';
import { jsonOutputOf, type AnswerSchemaCase } from '../schema-testing/answer-schemas.ts';
import type { Environment } from '../settings/setting-values.ts';
import { accessFor, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { enforcingGateway, gatewayModel } from './answers-in-turn.ts';
import { anthropicMessage, chatCompletion, geminiContent, openAiResponse } from './provider-replies.ts';
import { jsonResponse, recordingFetch } from './recording-fetch.ts';

export interface PortableRoute {
  readonly name: string;
  readonly environment: Environment;
  readonly model: string;
  readonly reply: (text: string) => object;
}

export const portableRoutes: readonly PortableRoute[] = [
  { name: 'openai', environment: { OPENAI_API_KEY: 'k' }, model: 'openai/gpt-5', reply: openAiResponse },
  {
    name: 'anthropic',
    environment: { ANTHROPIC_API_KEY: 'k' },
    model: 'anthropic/claude-sonnet-4-5',
    reply: anthropicMessage,
  },
  {
    name: 'google',
    environment: { GOOGLE_GENERATIVE_AI_API_KEY: 'k' },
    model: 'google/gemini-2.5-flash',
    reply: geminiContent,
  },
  { name: 'gateway', environment: enforcingGateway, model: gatewayModel, reply: chatCompletion },
];

export interface PortableExchange {
  readonly bodies: readonly unknown[];
  readonly result: ModelResult;
}

export async function exchangedThrough(route: PortableRoute, asked: AnswerSchemaCase): Promise<PortableExchange> {
  const written = JSON.stringify(writtenSamples[asked.name]);
  const recording = recordingFetch(() => jsonResponse(route.reply(written)));
  const access = await accessFor(route.environment, { fetch: recording.fetch });
  const result = await succeeded(access, textRequest(route.model, { output: jsonOutputOf(asked) }));
  return { bodies: recording.requests().map(({ body }) => body), result };
}

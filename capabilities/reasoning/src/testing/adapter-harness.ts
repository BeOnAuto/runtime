import { Effect, Result, type Exit } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import type { ModelAccessOptions } from '../providers/model-access-options.ts';
import { makeModelAccess, type ModelAccess } from '../providers/model-access.ts';
import { compileAnswerSchema, type AnswerSchema } from '../schema/answer-schema.ts';
import { readModelSettings } from '../settings/model-settings.ts';
import type { Environment } from '../settings/setting-values.ts';

export const promptText = 'PROMPT-TEXT-4c1e-confidential';

export const verdictSchema: AnswerSchema = Result.getOrThrow(
  compileAnswerSchema({
    type: 'object',
    properties: { verdict: { type: 'string' } },
    required: ['verdict'],
    additionalProperties: false,
  }),
);

export function textRequest(model: string, overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    model,
    instructions: 'Answer briefly',
    messages: [{ role: 'user', content: [{ type: 'text', text: promptText }] }],
    output: { type: 'text' },
    settings: { max_output_tokens: 256 },
    retries: 'caller',
    ...overrides,
  };
}

export function jsonRequest(model: string, overrides: Partial<ModelRequest> = {}): ModelRequest {
  return textRequest(model, { output: { type: 'json', schema: verdictSchema, name: 'verdict' }, ...overrides });
}

export function accessFor(environment: Environment, options: ModelAccessOptions): Promise<ModelAccess> {
  return Effect.runPromise(
    readModelSettings(environment).pipe(Effect.flatMap((settings) => makeModelAccess(settings, options))),
  );
}

export function generated(access: ModelAccess, request: ModelRequest): Promise<Exit.Exit<ModelResult, ModelFailure>> {
  return Effect.runPromiseExit(access.languageModel.generate(request));
}

export function succeeded(access: ModelAccess, request: ModelRequest): Promise<ModelResult> {
  return Effect.runPromise(access.languageModel.generate(request));
}

export function failed(access: ModelAccess, request: ModelRequest): Promise<ModelFailure> {
  return Effect.runPromise(Effect.flip(access.languageModel.generate(request)));
}

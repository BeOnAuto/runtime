import type { ContentOwner } from '@on.auto/content';
import type { InvalidInput } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { AudioEntry } from '../catalog/catalog-entry.ts';
import type { GenerationFunctionDefinitionDocument, GenerationParameters } from '../document/generation-document.ts';
import type { GenerationRequest } from '../gateway/generation-gateway.ts';
import { preparedInput } from './prepared-input.ts';
import { referencedAssets, type ReferenceReading, type ReferencedAsset } from './referenced-assets.ts';
import { renderedPrompt } from './rendered-prompt.ts';
import type { RunnableModel } from './runnable-model.ts';

export interface PreparedRequest {
  readonly request: GenerationRequest;
  readonly references: readonly ReferencedAsset[];
}

interface Preparing {
  readonly document: GenerationFunctionDefinitionDocument & { readonly produces: 'image' | 'audio' };
  readonly model: RunnableModel;
  readonly playbook: ContentOwner;
  readonly now: number;
}

function audioDefaults(parameters: GenerationParameters, { limits }: AudioEntry): GenerationParameters {
  const [voice] = limits.voices;
  const [format] = limits.formats;
  return { ...parameters, voice: parameters.voice ?? String(voice), format: parameters.format ?? String(format) };
}

function parametersSent({ entry }: RunnableModel, parameters: GenerationParameters): GenerationParameters {
  return entry.kind === 'audio' ? audioDefaults(parameters, entry) : parameters;
}

export function preparedRequest(
  reading: ReferenceReading,
  input: Schema.Json,
  { document, model, playbook, now }: Preparing,
): Effect.Effect<PreparedRequest, InvalidInput> {
  return Effect.gen(function* () {
    const fields = yield* preparedInput(input, document.input);
    const at = new Date(now).toISOString();
    const prompt = yield* renderedPrompt(
      document.prompt,
      { input: fields, today: at.slice(0, 10), now: at },
      model.entry.limits.prompt_characters,
    );
    const references = yield* referencedAssets(reading, fields, document.references, {
      playbook,
      entry: model.entry,
      now,
    });
    const request: GenerationRequest = {
      kind: document.produces,
      model: model.entry.model,
      prompt,
      parameters: parametersSent(model, document.parameters),
      references,
    };
    return { request, references };
  });
}

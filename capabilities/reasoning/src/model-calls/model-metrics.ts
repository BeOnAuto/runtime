import { Effect, Metric } from 'effect';

import type { ModelTarget } from '../model/model-resolution.ts';
import type { ModelResult } from '../model/model-result.ts';

type TokenType = 'input' | 'output';

type Attributes = Readonly<Record<string, string>>;

const tokenUsage = Metric.histogram('gen_ai.client.token.usage', {
  description: 'The tokens a call of a model took in and gave back',
  boundaries: [1, 4, 16, 64, 256, 1024, 4096, 16_384, 65_536, 262_144, 1_048_576, 4_194_304, 16_777_216, 67_108_864],
});

const operationSeconds = Metric.histogram('gen_ai.client.operation.duration', {
  description: 'How long a call of a model took, in seconds',
  boundaries: [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92],
});

function callAttributesOf({ provider, resolved }: ModelTarget): Attributes {
  return { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': provider, 'gen_ai.request.model': resolved };
}

function counted(attributes: Attributes, type: TokenType, tokens: number | null): Effect.Effect<void> {
  return tokens === null
    ? Effect.void
    : Metric.update(Metric.withAttributes(tokenUsage, { ...attributes, 'gen_ai.token.type': type }), tokens);
}

function timed(attributes: Attributes, milliseconds: number): Effect.Effect<void> {
  return Metric.update(Metric.withAttributes(operationSeconds, attributes), milliseconds / 1000);
}

export function callSucceeded(target: ModelTarget, { model, usage, duration_ms }: ModelResult): Effect.Effect<void> {
  const attributes = { ...callAttributesOf(target), 'gen_ai.response.model': model.answered };
  return Effect.all(
    [
      timed(attributes, duration_ms),
      counted(attributes, 'input', usage.input.total),
      counted(attributes, 'output', usage.output.total),
    ],
    { discard: true },
  );
}

export function callFailed(target: ModelTarget, errorType: string, milliseconds: number): Effect.Effect<void> {
  return timed({ ...callAttributesOf(target), 'error.type': errorType }, milliseconds);
}

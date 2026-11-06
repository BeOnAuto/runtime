import { Effect, Metric } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelRequest } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import type { ModelResult, OutputMode, Repair } from '../model/model-result.ts';

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

const jsonAnswers = Metric.counter('auto.on.json_answers', {
  description:
    'The final answers of model calls that asked for JSON, by provider, model and output mode, and how each was found: valid, valid after one correction, invalid, invalid with no room to correct it or with a correction that failed, or refused',
  incremental: true,
});

type JsonAnswerOutcome = 'valid' | 'valid_after_repair' | 'invalid' | 'repair_skipped' | 'repair_failed' | 'refused';

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

function answerChecked(
  target: ModelTarget,
  outcome: JsonAnswerOutcome,
  mode: OutputMode | undefined,
): Effect.Effect<void> {
  const attributes = {
    ...callAttributesOf(target),
    'auto.on.outcome': outcome,
    ...(mode === undefined ? {} : { 'auto.on.output_mode': mode }),
  };
  return Metric.update(Metric.withAttributes(jsonAnswers, attributes), 1);
}

export function answerSucceeded(target: ModelTarget, { json, repair, output_mode: mode }: ModelResult) {
  if (json === undefined) {
    return Effect.void;
  }
  return answerChecked(target, repair === undefined ? 'valid' : 'valid_after_repair', mode);
}

interface CheckedFailure {
  readonly _tag: ModelFailure['_tag'];
  readonly repair?: Repair;
  readonly output_mode?: OutputMode;
}

const unrepairedAs: Readonly<Record<Repair['outcome'], JsonAnswerOutcome>> = {
  repaired: 'invalid',
  invalid: 'invalid',
  failed: 'repair_failed',
  skipped: 'repair_skipped',
};

function unusableAs(kind: ModelFailure['_tag'], repair: Repair | undefined): JsonAnswerOutcome | undefined {
  if (kind === 'content_refused') {
    return 'refused';
  }
  if (kind !== 'output_invalid') {
    return undefined;
  }
  return repair === undefined ? 'invalid' : unrepairedAs[repair.outcome];
}

export function answerFailed(
  target: ModelTarget,
  { output }: ModelRequest,
  { _tag: kind, repair, output_mode: mode }: CheckedFailure,
): Effect.Effect<void> {
  const outcome = output.type === 'json' ? unusableAs(kind, repair) : undefined;
  return outcome === undefined ? Effect.void : answerChecked(target, outcome, mode);
}

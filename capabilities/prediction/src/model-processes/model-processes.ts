import { availableParallelism } from 'node:os';

import { pooledJob, type ProcessOutcome, type ProcessPool, type ProcessValue } from '@on.auto/workflow-engine/dsl';
import { Effect, Option, Schema } from 'effect';

import { BaselineSchema } from '../document/evaluation-names.ts';
import { TensorSchema } from '../facts/build-facts.ts';
import type { BaselinesJob, Fed, WalkJob, WindowJob } from '../model-jobs/model-feeds.ts';

export interface ModelDeadlines {
  readonly check: number;
  readonly run: number;
  readonly walk: number;
  readonly baselines: number;
}

export const modelDeadlines: ModelDeadlines = { check: 30_000, run: 10_000, walk: 600_000, baselines: 30_000 };

export const modelProcessModule = new URL('../model-jobs/model-process.ts', import.meta.url);

const Floats = Schema.declare((value: unknown): value is Readonly<Float32Array> => value instanceof Float32Array);

const Doubles = Schema.declare((value: unknown): value is Readonly<Float64Array> => value instanceof Float64Array);

const SignatureSchema = Schema.Union([
  Schema.Struct({
    loaded: Schema.Literal(true),
    inputs: Schema.Array(TensorSchema),
    outputs: Schema.Array(TensorSchema),
    opset: Schema.Int,
  }),
  Schema.Struct({ loaded: Schema.Literal(false), detail: Schema.String }),
]);

const BadlySchema = Schema.Struct({ badly: Schema.String });

const QuestionAnswerSchema = Schema.Struct({ q: Floats, dims: Schema.Array(Schema.Int) });

const WalkAnswerSchema = Schema.Struct({ series: Schema.Array(Schema.String), q: Schema.Array(Floats) });

const WindowAnswerSchema = Schema.Union([
  Schema.Struct({ unknown: Schema.Literal(true) }),
  Schema.Struct({ y: Doubles, x: Schema.NullOr(Floats), origin: Schema.Number }),
]);

const BaselinesAnswerSchema = Schema.Struct({ perfect: Schema.NullOr(BaselineSchema), unscorable: Schema.Boolean });

export type Signature = typeof SignatureSchema.Type;

type QuestionAnswer = typeof QuestionAnswerSchema.Type;

export type WalkAnswer = typeof WalkAnswerSchema.Type;

type WindowAnswer = typeof WindowAnswerSchema.Type;

type BaselinesAnswer = typeof BaselinesAnswerSchema.Type;

type Interrupted = Exclude<ProcessOutcome['ended'], 'answered' | 'crashed'>;

export type ModelOutcome<Answer> = { readonly milliseconds: number } & (
  | { readonly ended: 'answered'; readonly answer: Answer }
  | { readonly ended: 'badly' | 'crashed'; readonly detail: string }
  | { readonly ended: Interrupted }
);

interface ModelFile {
  readonly sha256: string;
  readonly path: string;
}

type Walk = Omit<WalkJob, 'model' | 'threads'>;

type Window = Omit<WindowJob, 'rows'>;

type Baselines = Omit<BaselinesJob, 'rows'>;

export interface ModelProcesses {
  readonly check: (model: ModelFile) => Effect.Effect<ModelOutcome<Signature>>;
  readonly run: (model: ModelFile, question: Fed) => Effect.Effect<ModelOutcome<QuestionAnswer>>;
  readonly walk: (model: ModelFile, walk: Walk) => Effect.Effect<ModelOutcome<WalkAnswer>>;
  readonly window: (rows: ModelFile, window: Window) => Effect.Effect<ModelOutcome<WindowAnswer>>;
  readonly baselines: (rows: ModelFile, baselines: Baselines) => Effect.Effect<ModelOutcome<BaselinesAnswer>>;
}

export interface ModelProcessSettings {
  readonly pool: ProcessPool;
  readonly module?: Readonly<URL>;
  readonly deadlines?: ModelDeadlines;
}

const decodeBadly = Schema.decodeUnknownOption(BadlySchema);

function outcomeOf<Answer>(
  outcome: ProcessOutcome,
  decode: (answer: unknown) => Option.Option<Answer>,
): ModelOutcome<Answer> {
  const { milliseconds } = outcome;
  if (outcome.ended !== 'answered') {
    return outcome;
  }
  const badly = decodeBadly(outcome.answer);
  if (Option.isSome(badly)) {
    return { ended: 'badly', detail: badly.value.badly, milliseconds };
  }
  return Option.match(decode(outcome.answer), {
    onNone: () => ({
      ended: 'crashed',
      detail: 'The model process answered what a model process does not',
      milliseconds,
    }),
    onSome: (answer) => ({ ended: 'answered', answer, milliseconds }),
  });
}

type JobKind = keyof ModelDeadlines | 'window';

export function threadsOf(processes: number, cores = availableParallelism()): number {
  return Math.max(1, Math.floor(cores / processes));
}

export function modelProcesses({
  pool,
  module = modelProcessModule,
  deadlines = modelDeadlines,
}: ModelProcessSettings): ModelProcesses {
  const threads = threadsOf(pool.processes);
  const asked = <Answer>(
    key: string,
    kind: JobKind,
    payload: { readonly [name: string]: ProcessValue },
    decode: (answer: unknown) => Option.Option<Answer>,
  ): Effect.Effect<ModelOutcome<Answer>> =>
    Effect.map(
      pooledJob('model', kind, (signal) =>
        pool.run(
          {
            module,
            key,
            kind,
            payload: { ...payload, threads },
            deadlineMs: kind === 'window' ? deadlines.run : deadlines[kind],
            long: kind === 'walk' || kind === 'check' || kind === 'baselines',
          },
          signal,
        ),
      ),
      (outcome) => outcomeOf(outcome, decode),
    );
  return {
    check: (model) => asked(model.sha256, 'check', { model: model.path }, Schema.decodeUnknownOption(SignatureSchema)),
    run: (model, question) =>
      asked(model.sha256, 'run', { ...question, model: model.path }, Schema.decodeUnknownOption(QuestionAnswerSchema)),
    walk: (model, walk) =>
      asked(model.sha256, 'walk', { ...walk, model: model.path }, Schema.decodeUnknownOption(WalkAnswerSchema)),
    window: (rows, window) =>
      asked(rows.sha256, 'window', { ...window, rows: rows.path }, Schema.decodeUnknownOption(WindowAnswerSchema)),
    baselines: (rows, baselines) =>
      asked(
        rows.sha256,
        'baselines',
        { ...baselines, rows: rows.path },
        Schema.decodeUnknownOption(BaselinesAnswerSchema),
      ),
  };
}

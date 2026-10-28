import { availableParallelism } from 'node:os';

import {
  CandidateSignatureSchema,
  type FedShape,
  type FunctionShape,
  type ModelRuntime,
} from '@on.auto/prediction-contract';
import {
  pooledJob,
  type InlinePool,
  type ModuleAddress,
  type ProcessOutcome,
  type ProcessPool,
  type ProcessValue,
} from '@on.auto/workflow-engine/dsl';
import { Effect, Option, Schema } from 'effect';

import { BaselineSchema } from '../document/evaluation-names.ts';
import type { BaselinesJob, Fed, WalkJob, WindowJob } from '../model-jobs/model-feeds.ts';
import { inlineModels } from './inline-models.ts';

export interface ModelDeadlines {
  readonly check: number;
  readonly run: number;
  readonly walk: number;
  readonly baselines: number;
  readonly fit: number;
}

export const modelDeadlines: ModelDeadlines = {
  check: 30_000,
  run: 10_000,
  walk: 600_000,
  baselines: 30_000,
  fit: 30_000,
};

export function modelProcessModule(): URL {
  return new URL('../model-jobs/model-process.ts', import.meta.url);
}

const Floats = Schema.declare((value: unknown): value is Readonly<Float32Array> => value instanceof Float32Array);

const Doubles = Schema.declare((value: unknown): value is Readonly<Float64Array> => value instanceof Float64Array);

const Bytes = Schema.declare((value: unknown): value is Readonly<Uint8Array> => value instanceof Uint8Array);

const SignatureSchema = Schema.Union([
  Schema.Struct({
    loaded: Schema.Literal(true),
    signature: CandidateSignatureSchema,
    issue: Schema.NullOr(Schema.String),
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

const FittedModelSchema = Schema.Struct({ format: Schema.String, bytes: Bytes });

const FitAnswerSchema = Schema.Struct({ models: Schema.Array(FittedModelSchema) });

export type Signature = typeof SignatureSchema.Type;

type QuestionAnswer = typeof QuestionAnswerSchema.Type;

export type WalkAnswer = typeof WalkAnswerSchema.Type;

type WindowAnswer = typeof WindowAnswerSchema.Type;

type BaselinesAnswer = typeof BaselinesAnswerSchema.Type;

export type FittedAnswer = typeof FittedModelSchema.Type;

type FitAnswer = typeof FitAnswerSchema.Type;

type Interrupted = Exclude<ProcessOutcome['ended'], 'answered' | 'crashed'>;

export type ModelOutcome<Answer> = { readonly milliseconds: number } & (
  | { readonly ended: 'answered'; readonly answer: Answer }
  | { readonly ended: 'badly' | 'crashed'; readonly detail: string }
  | { readonly ended: Interrupted }
);

export interface ModelFile {
  readonly sha256: string;
  readonly path: string;
}

type Walk = Omit<WalkJob, 'runtime' | 'model' | 'threads'>;

type Window = Omit<WindowJob, 'rows'>;

type Baselines = Omit<BaselinesJob, 'rows'>;

export interface ModelProcesses {
  readonly check: (runtime: ModelRuntime, model: ModelFile, fed: FedShape) => Effect.Effect<ModelOutcome<Signature>>;
  readonly run: (runtime: ModelRuntime, model: ModelFile, question: Fed) => Effect.Effect<ModelOutcome<QuestionAnswer>>;
  readonly walk: (runtime: ModelRuntime, model: ModelFile, walk: Walk) => Effect.Effect<ModelOutcome<WalkAnswer>>;
  readonly fit: (
    runtime: ModelRuntime,
    rows: ModelFile,
    shape: FunctionShape,
  ) => Effect.Effect<ModelOutcome<FitAnswer>>;
  readonly defaultModel: (runtime: ModelRuntime, shape: FunctionShape) => Effect.Effect<ModelOutcome<FittedAnswer>>;
  readonly window: (rows: ModelFile, window: Window) => Effect.Effect<ModelOutcome<WindowAnswer>>;
  readonly baselines: (rows: ModelFile, baselines: Baselines) => Effect.Effect<ModelOutcome<BaselinesAnswer>>;
}

export interface ModelProcessSettings {
  readonly pool: ProcessPool;
  readonly inline?: InlinePool;
  readonly module?: ModuleAddress;
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

type JobKind = keyof ModelDeadlines | 'window' | 'default';

interface Asked {
  readonly key: string;
  readonly kind: JobKind;
  readonly payload: { readonly [name: string]: ProcessValue };
  readonly inline: boolean;
}

const longJobs: ReadonlySet<JobKind> = new Set(['walk', 'check', 'baselines', 'fit']);

export function threadsOf(processes: number, cores = availableParallelism()): number {
  return Math.max(1, Math.floor(cores / processes));
}

function runtimeJob(kind: JobKind, runtime: ModelRuntime, of: string, payload: Asked['payload']): Asked {
  const address = runtime.binding.module().href;
  return {
    key: JSON.stringify([address, of]),
    kind,
    payload: { ...payload, runtime: address },
    inline: runtime.binding.kind === 'inline',
  };
}

function modelJob(kind: JobKind, runtime: ModelRuntime, model: ModelFile, payload: Asked['payload']): Asked {
  return runtimeJob(kind, runtime, model.sha256, { ...payload, model: model.path });
}

function deadlineOf(deadlines: ModelDeadlines, kind: JobKind): number {
  return kind === 'window' || kind === 'default' ? deadlines.run : deadlines[kind];
}

type Asker = <Answer>(
  job: Asked,
  decode: (answer: unknown) => Option.Option<Answer>,
) => Effect.Effect<ModelOutcome<Answer>>;

function askerOf({
  pool,
  inline = inlineModels(pool),
  module = modelProcessModule,
  deadlines = modelDeadlines,
}: ModelProcessSettings): Asker {
  const threads = threadsOf(pool.processes);
  return (job, decode) => {
    const request = {
      kind: job.kind,
      payload: { ...job.payload, threads },
      deadlineMs: deadlineOf(deadlines, job.kind),
      long: longJobs.has(job.kind),
    };
    return Effect.map(
      pooledJob('model', job.kind, (signal) =>
        job.inline ? inline.run(request, signal) : pool.run({ ...request, module, key: job.key }, signal),
      ),
      (outcome) => outcomeOf(outcome, decode),
    );
  };
}

export function modelProcesses(settings: ModelProcessSettings): ModelProcesses {
  const asked = askerOf(settings);
  return {
    check: (runtime, model, fed) =>
      asked(modelJob('check', runtime, model, { fed: { ...fed } }), Schema.decodeUnknownOption(SignatureSchema)),
    run: (runtime, model, question) =>
      asked(modelJob('run', runtime, model, { ...question }), Schema.decodeUnknownOption(QuestionAnswerSchema)),
    walk: (runtime, model, walk) =>
      asked(modelJob('walk', runtime, model, { ...walk }), Schema.decodeUnknownOption(WalkAnswerSchema)),
    fit: (runtime, rows, shape) =>
      asked(
        runtimeJob('fit', runtime, rows.sha256, { rows: rows.path, shape: { ...shape, fed: { ...shape.fed } } }),
        Schema.decodeUnknownOption(FitAnswerSchema),
      ),
    defaultModel: (runtime, shape) =>
      asked(
        runtimeJob('default', runtime, 'default', { shape: { ...shape, fed: { ...shape.fed } } }),
        Schema.decodeUnknownOption(FittedModelSchema),
      ),
    window: (rows, window) =>
      asked(
        { key: rows.sha256, kind: 'window', payload: { ...window, rows: rows.path }, inline: false },
        Schema.decodeUnknownOption(WindowAnswerSchema),
      ),
    baselines: (rows, baselines) =>
      asked(
        { key: rows.sha256, kind: 'baselines', payload: { ...baselines, rows: rows.path }, inline: false },
        Schema.decodeUnknownOption(BaselinesAnswerSchema),
      ),
  };
}

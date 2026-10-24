import type { RunJournal } from '@on.auto/definitions';
import type { Conflict, RunCancelled } from '@on.auto/operations';
import type { CallStarted, OfferedTool, RunTools } from '@on.auto/tool-servers';
import { Clock, Data, Duration, Effect, Option, Result } from 'effect';

import type { PerformJob } from '../jobs/jobs.ts';
import { interruptedEnds, type StepFact } from './attempt-facts.ts';
import type { KeptContent } from './kept-content.ts';
import type { StepBounds } from './step-decision.ts';
import type { Kept, Offered, RequestBase } from './step-facts.ts';
import { evolve, type StepContent, type StepState } from './step-state.ts';

export type StepTool = Pick<OfferedTool, 'name' | 'description' | 'inputSchema' | 'reference' | 'readOnly' | 'start'>;

export interface StepTools {
  readonly offered: readonly StepTool[];
  readonly definitions: readonly Pick<StepTool, 'name' | 'description' | 'inputSchema'>[];
  readonly argumentsDigest?: (input: unknown) => string;
  readonly scrubJson: (json: string) => string;
}

export function stepToolsOf(tools: RunTools | undefined): StepTools {
  if (tools === undefined) {
    return { offered: [], definitions: [], scrubJson: (json) => json };
  }
  const { offered, argumentsDigest, scrubJson } = tools;
  const definitions = offered.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  return { offered, definitions, argumentsDigest, scrubJson };
}

export interface StepRun {
  readonly model: string;
  readonly base: RequestBase;
  readonly tools: StepTools;
  readonly bounds: StepBounds;
  readonly journal: RunJournal;
  readonly kept: KeptContent | undefined;
  readonly perform: PerformJob;
  readonly startedAt: number;
}

export interface CancelledEnding {
  readonly type: 'cancelled';
  readonly detail: string;
  readonly kind: RunCancelled['kind'];
}

export class StepCancelled extends Data.TaggedError('step_cancelled')<{
  readonly state: StepState;
  readonly ending: CancelledEnding;
}> {}

export type StepRefusal = Conflict | StepCancelled;

function recordedAfter(run: StepRun, state: StepState, fact: StepFact): Effect.Effect<number, StepRefusal> {
  return Effect.catchTag(run.journal.record(fact), 'cancelled', ({ detail, kind }: Omit<CancelledEnding, 'type'>) =>
    Effect.fail(new StepCancelled({ state, ending: { type: 'cancelled', detail, kind } })),
  );
}

export function recordedOn(
  run: StepRun,
  state: StepState,
  fact: StepFact,
  content: StepContent,
): Effect.Effect<StepState, StepRefusal> {
  return Effect.as(recordedAfter(run, state, fact), evolve(state, fact, content));
}

export interface Opened {
  readonly state: StepState;
  readonly number: number;
}

export function startedOn(run: StepRun, state: StepState, data: CallStarted): Effect.Effect<Opened, StepRefusal> {
  const fact: StepFact = { type: 'tool_call_started', data: { ...data, number: state.facts.numbering.lastCall + 1 } };
  return Effect.map(recordedAfter(run, state, fact), (number) => ({ state: evolve(state, fact, {}), number }));
}

export function interruptedOn(run: StepRun, state: StepState): Effect.Effect<StepState, StepRefusal> {
  return Effect.reduce(
    interruptedEnds(state.facts, run.model),
    () => state,
    (now, fact) => recordedOn(run, now, fact, {}),
  );
}

const utf8 = new TextEncoder();

export interface Scrubbed {
  readonly text: string;
  readonly kept: Kept;
}

export function keptOf({ kept, tools }: StepRun, text: string): Effect.Effect<Scrubbed> {
  const scrubbed = tools.scrubJson(text);
  const keeping: Effect.Effect<Kept> =
    kept === undefined ? Effect.succeed({ bytes: utf8.encode(scrubbed).byteLength }) : kept.keep(scrubbed);
  return Effect.map(keeping, (measured: Kept) => ({ text: scrubbed, kept: measured }));
}

export function offeredOf({ tools, kept }: StepRun): Offered {
  const references = new Map(tools.offered.map(({ name, reference }) => [name, reference]));
  const { argumentsDigest } = tools;
  return kept === undefined || argumentsDigest === undefined ? { references } : { references, argumentsDigest };
}

export function withinTheBound<A, E>(
  { bounds, startedAt }: StepRun,
  work: Effect.Effect<A, E>,
): Effect.Effect<Result.Result<A, StepBounds>, E> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Effect.map(
      Effect.timeoutOption(work, Duration.millis(Math.max(0, startedAt + bounds.runBoundMs - now))),
      Option.match({ onNone: () => Result.fail(bounds), onSome: Result.succeed }),
    ),
  );
}

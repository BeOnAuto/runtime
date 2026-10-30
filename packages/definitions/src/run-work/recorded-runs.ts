import {
  PlaybookIdSchema,
  OrgIdSchema,
  recordedDecoder,
  streamPrefixOfPlaybook,
  type StreamReader,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { RunEventSchema, type RecordedRunEvent } from '../runs/run-events.ts';
import { runDetailOf } from '../runs/run-lookup.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';
import {
  startedRunOf,
  takesSettlement,
  type RecordedAnswer,
  type RecordedWork,
  type RunStreamState,
} from '../runs/run-state.ts';
import type { RunDetail } from '../runs/run.ts';

export interface RecordedRun {
  readonly run: RunDetail;
  readonly input: Schema.Json;
  readonly awaitsSettlement: boolean;
  readonly work: readonly RecordedWork[];
  readonly answer: RecordedAnswer | null;
  readonly depth: number;
  readonly callDepth: number;
}

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, playbook: PlaybookIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const decodeRunEvent = recordedDecoder(RunEventSchema);

export function runEventOf(recorded: unknown): RecordedRunEvent | undefined {
  return Option.getOrUndefined(decodeRunEvent(recorded));
}

function recordedOf(id: string, state: RunStreamState): Effect.Effect<RecordedRun | undefined> {
  const run = startedRunOf(state);
  return run === undefined
    ? Effect.undefined
    : Effect.map(Effect.orDie(runDetailOf(id, state)), (detail) => ({
        run: detail,
        input: run.input,
        awaitsSettlement: takesSettlement(run),
        work: run.work,
        answer: run.answer,
        depth: run.depth,
        callDepth: run.callDepth,
      }));
}

export function recordedRunIn(reader: StreamReader, address: RunStreamAddress): Effect.Effect<RecordedRun | undefined> {
  if (!isWellFormed(address)) {
    return Effect.undefined;
  }
  const id = address.id.toLowerCase();
  return reader
    .load(`${streamPrefixOfPlaybook(address)}${runStreamNameOf(id)}`, runDecider)
    .pipe(Effect.flatMap(({ state }) => recordedOf(id, state)));
}

export function recordedRunInPlaybook(reader: StreamReader, id: string): Effect.Effect<RecordedRun | undefined> {
  const run = id.toLowerCase();
  return reader.load(runStreamNameOf(run), runDecider).pipe(Effect.flatMap(({ state }) => recordedOf(run, state)));
}

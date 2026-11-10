import {
  mostRecordsInAPage,
  PlaybookIdSchema,
  OrgIdSchema,
  recordedDecoder,
  streamPrefixOfPlaybook,
  type RecordedPageRequest,
  type RecordedReader,
  type StreamReader,
} from '@on.auto/operations';
import type { Payload } from '@on.auto/operations/payloads';
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
import type { RunDetailAsRecorded } from '../runs/run.ts';

export interface RecordedRun {
  readonly run: RunDetailAsRecorded;
  readonly input: Payload<Schema.Json>;
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

const RunFirstSchema = Schema.Struct({ correlationId: Schema.String, cursor: Schema.String });

type RunFirst = typeof RunFirstSchema.Type;

const decodeFirst = Schema.decodeUnknownSync(RunFirstSchema);

function noRunAt({ id }: RunStreamAddress): Error {
  return new Error(`There is no run ${id} in this playbook to read the first record of`);
}

function firstOfTheRun(
  reader: Pick<RecordedReader, 'readRecorded'>,
  address: RunStreamAddress,
  cursor?: string,
): Effect.Effect<RunFirst> {
  const page: RecordedPageRequest = {
    order: 'desc',
    limit: mostRecordsInAPage,
    dataOf: [],
    ...(cursor === undefined ? {} : { cursor }),
  };
  return reader.readRecorded(address, { kind: 'run', run: address.id }, page).pipe(
    Effect.orDie,
    Effect.flatMap(({ records, nextCursor }) => {
      if (nextCursor !== null) {
        return firstOfTheRun(reader, address, nextCursor);
      }
      const oldest = records.at(-1);
      return oldest === undefined ? Effect.die(noRunAt(address)) : Effect.sync(() => decodeFirst(oldest));
    }),
  );
}

export function runCorrelationIn(
  reader: Pick<RecordedReader, 'readRecorded'>,
  address: RunStreamAddress,
): Effect.Effect<string> {
  return Effect.map(firstOfTheRun(reader, address), ({ correlationId }) => correlationId);
}

export function runStartCursorIn(
  reader: Pick<RecordedReader, 'readRecorded'>,
  address: RunStreamAddress,
): Effect.Effect<string> {
  return Effect.map(firstOfTheRun(reader, address), ({ cursor }) => cursor);
}

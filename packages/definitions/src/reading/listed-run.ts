import {
  CancelledKindSchema,
  ConflictKindSchema,
  InvalidInputKindSchema,
  UnansweredKindSchema,
  RejectionBecauseSchema,
  UnavailableKindSchema,
  type RecordedEvent,
} from '@on.auto/operations';
import { Effect, Schema, Struct } from 'effect';

import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { RunEventSchema, type RecordedRunEvent } from '../runs/run-events.ts';
import { runOf } from '../runs/run-lookup.ts';
import { evolveRun, startedRunOf, type RunStreamState } from '../runs/run-state.ts';
import { RunSchema, type Run, type RunRejection } from '../runs/run.ts';

const ListedRejectionSchema = Schema.Struct({
  reason: Schema.Literals(['invalid_input', 'unavailable', 'conflict', 'cancelled', 'unanswered']),
  kind: Schema.optionalKey(
    Schema.Union([
      InvalidInputKindSchema,
      UnavailableKindSchema,
      ConflictKindSchema,
      CancelledKindSchema,
      UnansweredKindSchema,
    ]),
  ),
  because: Schema.optionalKey(RejectionBecauseSchema),
}).annotate({
  description:
    'Why the run was rejected: its reason, the kind it gave for invalid_input, unavailable or conflict, the kind of a cancellation or of a request nobody answered, and for unavailable or conflict the because it gave',
});

export const ListedRunSchema = Schema.Struct({
  ...Struct.omit(RunSchema.fields, ['output', 'rejection']),
  rejection: Schema.optionalKey(ListedRejectionSchema),
}).annotate({
  identifier: 'ListedRun',
  description: 'One run of a definition and how it ended, without its output, its record and the detail of a rejection',
});

export type ListedRun = typeof ListedRunSchema.Type;

type ListedRejection = NonNullable<ListedRun['rejection']>;

const decodeEvent = Schema.decodeUnknownEffect(Schema.toCodecJson(RunEventSchema));

const runStreamPrefix = runStreamNameOf('');

function runsOf(records: readonly RecordedEvent[]): ReadonlyMap<string, readonly RecordedEvent[]> {
  const runs = new Map<string, readonly RecordedEvent[]>();
  for (const record of records) {
    runs.set(record.stream, [...(runs.get(record.stream) ?? []), record]);
  }
  return runs;
}

function listedRejectionOf(rejection: RunRejection): ListedRejection {
  if (rejection.reason === 'invalid_input') {
    const { reason, kind } = rejection;
    return kind === undefined ? { reason } : { reason, kind };
  }
  if (rejection.reason === 'cancelled' || rejection.reason === 'unanswered') {
    const { reason, kind } = rejection;
    return { reason, kind };
  }
  const { reason, kind, because } = rejection;
  return { reason, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
}

function listedOf(run: Run): ListedRun {
  const listed = Struct.omit(run, ['output', 'rejection']);
  return run.rejection === undefined ? listed : { ...listed, rejection: listedRejectionOf(run.rejection) };
}

function recordedRunEventOf({
  type,
  data,
  context,
}: RecordedEvent): Effect.Effect<RecordedRunEvent, Schema.SchemaError> {
  return decodeEvent({ type, data, context });
}

function listedRunOf(stream: string, heads: readonly RecordedEvent[]): Effect.Effect<ListedRun> {
  return Effect.forEach(heads, recordedRunEventOf).pipe(
    Effect.map((events: readonly RecordedRunEvent[]) =>
      events.reduce(
        (state: RunStreamState, event: RecordedRunEvent) => evolveRun(state, event),
        runDecider.initialState,
      ),
    ),
    Effect.flatMap((state) => runOf(stream.slice(runStreamPrefix.length), startedRunOf(state))),
    Effect.orDie,
    Effect.map(listedOf),
  );
}

export function listedRunsOf(records: readonly RecordedEvent[]): Effect.Effect<readonly ListedRun[]> {
  return Effect.forEach(runsOf(records), ([stream, heads]: readonly [string, readonly RecordedEvent[]]) =>
    listedRunOf(stream, heads),
  );
}

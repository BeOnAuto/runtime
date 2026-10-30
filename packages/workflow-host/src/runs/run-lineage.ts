import { messageIdOf, type Lineage } from '@on.auto/operations';
import {
  callKeyText,
  type OutputOrigin,
  type RecordLineage,
  type RunContext,
  type StepKey,
} from '@on.auto/workflow-engine';
import { Effect, Option, Schema } from 'effect';

import { startedByOf } from '../calls/call-rows.ts';
import type { HostDatabase } from '../database/host-database.ts';
import { armedByOfListener } from '../listeners/listener-rows.ts';
import { armedByOf } from '../timers/sql-timers.ts';
import { addressOfRun, runLogStreamOf } from './run-address.ts';

const GivenLineageSchema = Schema.Struct({
  lineage: Schema.Struct({ start: Schema.String, correlation: Schema.String }),
});

interface GivenLineage {
  readonly start: string | null;
  readonly correlation: string;
}

const decodeGiven = Schema.decodeUnknownOption(GivenLineageSchema);

function givenOf(runKey: string, attributes: Schema.JsonObject): GivenLineage {
  return Option.match(decodeGiven(attributes), {
    onNone: () => ({ start: null, correlation: addressOfRun(runKey).runId }),
    onSome: ({ lineage }) => lineage,
  });
}

export function correlationOfRun(runKey: string, attributes: Schema.JsonObject): string {
  return givenOf(runKey, attributes).correlation;
}

export function recordIdOf(runKey: string, version: number | null): string | null {
  return version === null ? null : messageIdOf(runLogStreamOf(runKey), version);
}

function waitBeganIn(
  database: HostDatabase,
  runKey: string,
  { reference, run }: StepKey,
): Effect.Effect<number | null> {
  const key = callKeyText({ runId: runKey, reference, run });
  return Effect.orDie(
    Effect.flatMap(startedByOf(database, key), (startedBy) =>
      startedBy === null ? armedByOfListener(database, runKey, key) : Effect.succeed(startedBy),
    ),
  );
}

function causeOfRecord(
  database: HostDatabase,
  runKey: string,
  { cause }: RecordLineage,
  given: GivenLineage,
): Effect.Effect<string | null> {
  if (cause.kind === 'start') {
    return Effect.succeed(given.start);
  }
  if (cause.kind === 'resumed') {
    return Effect.map(waitBeganIn(database, runKey, cause.step), (version) => recordIdOf(runKey, version));
  }
  if (cause.kind === 'given') {
    return Effect.succeed(cause.id);
  }
  return cause.kind === 'timer'
    ? Effect.map(armedByOf(database, runKey, cause.timerId), (armedBy) => recordIdOf(runKey, armedBy))
    : Effect.succeed(null);
}

export function lineageOfRecord(
  database: HostDatabase,
  runKey: string,
  lineage: RecordLineage,
): Effect.Effect<Lineage> {
  const given = givenOf(runKey, lineage.attributes);
  return Effect.map(causeOfRecord(database, runKey, lineage, given), (causationId) => ({
    causationId,
    correlationId: given.correlation,
  }));
}

export function lineageOfSettlement({ runId: runKey, attributes }: RunContext, { version }: OutputOrigin): Lineage {
  return {
    causationId: messageIdOf(runLogStreamOf(runKey), version),
    correlationId: givenOf(runKey, attributes).correlation,
  };
}

import {
  checkedContext,
  noLineage,
  noStreamToScrub,
  notAPositionOfTheStream,
  notTheShapeOf,
  recordingOf,
  type FactScrub,
  type FactScrubber,
  type Recorded,
  type ScrubbedStream,
  type ScrubRefused,
} from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

import { measuredWhole, payloadsDeclaredBy } from '../appends/payloads-declared.ts';
import { eventCodecOf } from '../event-codec.ts';
import type { FactScrubStore } from '../event-store.ts';
import { isVersionConflict, retriedOnVersionConflict, VersionConflict } from '../version-conflict.ts';

function conflictOrDefect(error: unknown): Effect.Effect<never, VersionConflict> {
  return isVersionConflict(error) ? Effect.fail(new VersionConflict()) : Effect.die(error);
}

function scrubbedOnce<Event extends Recorded>(
  store: FactScrubStore,
  stream: string,
  position: number,
  { eventSchema, data, erasure, context, lineage = noLineage }: FactScrub<Event>,
): Effect.Effect<Result.Result<ScrubbedStream, ScrubRefused>, VersionConflict> {
  const decodeFact = Schema.decodeUnknownEffect(Schema.toCodecJson(eventSchema));
  return Effect.gen(function* () {
    const at = yield* Effect.promise(() => store.factAt(stream, position));
    if (at.found === 'no_stream') {
      return Result.fail(noStreamToScrub);
    }
    if (at.found === 'no_fact') {
      return Result.fail(notAPositionOfTheStream(position, at.version));
    }
    const decoded = yield* Effect.result(decodeFact({ type: at.type, data, context: at.context }));
    if (Result.isFailure(decoded)) {
      return Result.fail(notTheShapeOf(at.type));
    }
    const { encode } = eventCodecOf(eventSchema);
    const declared = payloadsDeclaredBy(eventSchema);
    const { data: scrubbedData, payloadBytes } = measuredWhole(declared, yield* encode(decoded.success));
    const checked = yield* Effect.sync(() => checkedContext(context));
    const recorded = yield* Effect.sync(() => recordingOf(eventSchema)(erasure, checked));
    const encoded = measuredWhole(declared, yield* encode(recorded));
    const place = { expectedVersion: at.version, context: checked, lineage };
    const scrubbed = { position, data: scrubbedData, ...(payloadBytes === undefined ? {} : { payloadBytes }) };
    yield* Effect.tryPromise({
      try: () => store.scrub(stream, scrubbed, encoded, place),
      catch: (error) => error,
    }).pipe(Effect.catch(conflictOrDefect));
    return Result.succeed({ version: at.version + 1 });
  });
}

export function factScrubberOf(store: FactScrubStore): FactScrubber {
  return {
    scrubFact: (stream, position, scrub) =>
      retriedOnVersionConflict(scrubbedOnce(store, stream, position, scrub)).pipe(Effect.flatMap(Effect.fromResult)),
  };
}

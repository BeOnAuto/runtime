import { Clock, Effect, Schema } from 'effect';

import {
  checkedContext,
  noLineage,
  noStreamToScrub,
  notAPositionOfTheStream,
  notTheShapeOf,
  recordingOf,
  type Ledger,
} from '../index.ts';
import type { LoggedFact } from '../projections/memory-projections.ts';
import { appendedTo, messageOf, storedIn, type Kept } from './memory-appends.ts';
import { encodedWith } from './memory-payloads.ts';

function loggedFactsOf({ log }: Pick<Kept, 'log'>): readonly LoggedFact[] {
  return log.map(({ stream, streamPosition, type, data, context }) => ({
    stream,
    streamPosition,
    type,
    data,
    context,
  }));
}

export function scrubbedOn(kept: Kept): Ledger['Service']['scrubFact'] {
  return (stream, position, { eventSchema, data, erasure, context, lineage = noLineage }) =>
    Effect.gen(function* () {
      const facts = storedIn(kept, stream);
      if (facts.length === 0) {
        return yield* Effect.fail(noStreamToScrub);
      }
      const fact = facts[position - 1];
      if (fact === undefined) {
        return yield* Effect.fail(notAPositionOfTheStream(position, facts.length));
      }
      const decodeFact = Schema.decodeUnknownEffect(Schema.toCodecJson(eventSchema));
      const decoded = yield* Effect.mapError(decodeFact({ type: fact.type, data, context: fact.context }), () =>
        notTheShapeOf(fact.type),
      );
      const scrubbed = yield* encodedWith(eventSchema, fact.context)(decoded);
      const checked = yield* Effect.sync(() => checkedContext(context));
      const recorded = yield* Effect.sync(() => recordingOf(eventSchema)(erasure, checked));
      const stored = yield* encodedWith(eventSchema, checked)(recorded);
      appendedTo(kept, [{ stream, stored: [stored], lineage }], yield* Clock.currentTimeMillis);
      const after = scrubbed;
      kept.rewritten(stream, position, after);
      kept.projected.refold(loggedFactsOf(kept), {
        stream,
        before: messageOf(stream, position, fact),
        after: messageOf(stream, position, after),
      });
      kept.outcomes.refold(stream, storedIn(kept, stream));
      kept.references.refold(stream, storedIn(kept, stream));
      return { version: facts.length + 1 };
    });
}

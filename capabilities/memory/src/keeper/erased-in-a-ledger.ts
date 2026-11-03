import { Conflict, type Context, type FactScrub, type NotFound } from '@on.auto/operations';
import { Effect, Struct, type Schema } from 'effect';

import { memoryDecider, type MemoryState } from '../facts/memory-decider.ts';
import { MemoryFactSchema, type RecordedMemoryFact } from '../facts/memory-fact-schema.ts';
import type { RememberedData } from '../facts/memory-facts.ts';
import { memoryStreamOf, type MemoryAt } from '../facts/memory-streams.ts';
import type { Acting, MemoryLedger } from './memory-keeper.ts';

function scrubbedOf(data: RememberedData, at: string): Schema.JsonObject {
  return { ...Struct.omit(data, ['text', 'tags', 'about']), tags: [], text: null, erased_at: at };
}

function scrubOf(data: RememberedData, context: Context): FactScrub<RecordedMemoryFact> {
  return {
    eventSchema: MemoryFactSchema,
    data: scrubbedOf(data, context.at),
    erasure: { type: 'memory_erased', data: { version: data.version } },
    context,
  };
}

function refusedScrub({ id }: MemoryAt): (refusal: { readonly detail: string }) => Effect.Effect<never, Conflict> {
  return ({ detail }) =>
    Effect.fail(new Conflict({ detail: `The text of the memory ${id} could not be erased: ${detail}` }));
}

function forgottenBeforeErasing(
  ledger: MemoryLedger,
  at: MemoryAt,
  state: MemoryState,
  { context, lineage }: Acting,
): Effect.Effect<MemoryState, NotFound | Conflict> {
  return state.status === 'kept' || state.facts === 0
    ? Effect.map(
        ledger.execute(memoryStreamOf(at), memoryDecider, { kind: 'forget', at, context }, lineage),
        (forgetting) => forgetting.state,
      )
    : Effect.succeed(state);
}

function linkedTo({ place }: MemoryAt, { moved, movedFrom }: MemoryState): readonly MemoryAt[] {
  const { org } = place;
  const forward =
    moved === undefined
      ? []
      : [{ place: { org, playbook: moved.playbook ?? place.playbook }, scope: moved.to, id: moved.as }];
  const backward =
    movedFrom === undefined
      ? []
      : [{ place: { org, playbook: movedFrom.playbook ?? place.playbook }, scope: movedFrom.scope, id: movedFrom.id }];
  return [...forward, ...backward];
}

export const erasedIn = Effect.fnUntraced(function* (ledger: MemoryLedger, at: MemoryAt, acting: Acting) {
  const stream = memoryStreamOf(at);
  const { state } = yield* ledger.load(stream, memoryDecider);
  const { withText } = yield* forgottenBeforeErasing(ledger, at, state, acting);
  yield* Effect.forEach(
    withText.toReversed(),
    ({ position, data }) =>
      ledger
        .scrubFact(stream, position, scrubOf(data, acting.context))
        .pipe(Effect.catchTag('scrub_refused', refusedScrub(at))),
    { discard: true },
  );
  return linkedTo(at, state);
});

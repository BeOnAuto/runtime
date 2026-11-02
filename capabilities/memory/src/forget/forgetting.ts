import { Conflict, NotFound, type Context, type FactScrub } from '@on.auto/operations';
import { Effect, Struct, type Schema } from 'effect';

import type { MemoryPorts } from '../capability/memory-ports.ts';
import { memoryDecider, type MemoryState } from '../facts/memory-decider.ts';
import { MemoryFactSchema, type RecordedMemoryFact } from '../facts/memory-fact-schema.ts';
import type { MemoryScope, RememberedData } from '../facts/memory-facts.ts';
import { memoryStreamOf, type MemoryAt, type MemoryPlace } from '../facts/memory-streams.ts';
import type { Acting } from '../remember/remembering.ts';

interface Forgotten {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly status: 'forgotten' | 'erased';
}

export interface FoundMemory {
  readonly at: MemoryAt;
  readonly state: MemoryState;
}

const scopesSearched: readonly MemoryScope[] = ['playbook', 'organization'];

function stateAt(ports: MemoryPorts, at: MemoryAt): Effect.Effect<FoundMemory> {
  return Effect.map(ports.ledger.load(memoryStreamOf(at), memoryDecider), ({ state }) => ({ at, state }));
}

export const foundIn = Effect.fnUntraced(function* (ports: MemoryPorts, place: MemoryPlace, id: string) {
  for (const scope of scopesSearched) {
    const found = yield* stateAt(ports, { place, scope, id });
    if (found.state.status !== undefined) {
      return found;
    }
  }
  return yield* new NotFound({
    detail: `There is no memory ${id} among the playbook's memories or its organization's`,
  });
});

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
  ports: MemoryPorts,
  { at, state }: FoundMemory,
  { context, lineage }: Acting,
): Effect.Effect<MemoryState, NotFound | Conflict> {
  return state.status === 'kept' || state.facts === 0
    ? Effect.map(
        ports.ledger.execute(memoryStreamOf(at), memoryDecider, { kind: 'forget', at, context }, lineage),
        (forgetting) => forgetting.state,
      )
    : Effect.succeed(state);
}

const textErased = Effect.fnUntraced(function* (ports: MemoryPorts, found: FoundMemory, acting: Acting) {
  const stream = memoryStreamOf(found.at);
  const { withText } = yield* forgottenBeforeErasing(ports, found, acting);
  yield* Effect.forEach(
    withText.toReversed(),
    ({ position, data }) =>
      ports.ledger
        .scrubFact(stream, position, scrubOf(data, acting.context))
        .pipe(Effect.catchTag('scrub_refused', refusedScrub(found.at))),
    { discard: true },
  );
});

function linkedTo({ at, state }: FoundMemory): readonly MemoryAt[] {
  const { moved, movedFrom } = state;
  const { org } = at.place;
  const forward =
    moved === undefined
      ? []
      : [{ place: { org, playbook: moved.playbook ?? at.place.playbook }, scope: moved.to, id: moved.as }];
  const backward =
    movedFrom === undefined
      ? []
      : [
          {
            place: { org, playbook: movedFrom.playbook ?? at.place.playbook },
            scope: movedFrom.scope,
            id: movedFrom.id,
          },
        ];
  return [...forward, ...backward];
}

const lineageErased = Effect.fnUntraced(function* (ports: MemoryPorts, first: FoundMemory, acting: Acting) {
  const waiting: FoundMemory[] = [first];
  const seen = new Set<string>([memoryStreamOf(first.at)]);
  for (let found = waiting.shift(); found !== undefined; found = waiting.shift()) {
    yield* textErased(ports, found, acting);
    for (const at of linkedTo(found).filter((linked) => !seen.has(memoryStreamOf(linked)))) {
      seen.add(memoryStreamOf(at));
      waiting.push(yield* stateAt(ports, at));
    }
  }
});

export const forgotten = Effect.fnUntraced(function* (
  ports: MemoryPorts,
  found: FoundMemory,
  erase: boolean,
  acting: Acting,
) {
  const { id, scope } = found.at;
  if (erase) {
    yield* lineageErased(ports, found, acting);
    const erased: Forgotten = { id, scope, status: 'erased' };
    return erased;
  }
  const { state } = yield* ports.ledger.execute(
    memoryStreamOf(found.at),
    memoryDecider,
    { kind: 'forget', at: found.at, context: acting.context },
    acting.lineage,
  );
  const answer: Forgotten = { id, scope, status: state.status === 'erased' ? 'erased' : 'forgotten' };
  return answer;
});

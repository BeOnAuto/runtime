import { NotFound } from '@on.auto/operations';
import { Effect } from 'effect';

import { keeperOf, type MemoryPorts } from '../capability/memory-ports.ts';
import type { MemoryScope } from '../facts/memory-facts.ts';
import { memoryStreamOf, type MemoryAt, type MemoryPlace } from '../facts/memory-streams.ts';
import type { Acting, ForgottenStatus } from '../keeper/memory-keeper.ts';

interface Forgotten {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly status: ForgottenStatus;
}

export interface Forgetting {
  readonly place: MemoryPlace;
  readonly acting: Acting;
}

const scopesSearched: readonly MemoryScope[] = ['playbook', 'organization'];

export const foundIn = Effect.fnUntraced(function* (ports: MemoryPorts, place: MemoryPlace, id: string) {
  for (const scope of scopesSearched) {
    const at: MemoryAt = { place, scope, id };
    const status = yield* keeperOf(ports, place, at).standingOf(at);
    if (status !== undefined) {
      return at;
    }
  }
  return yield* new NotFound({
    detail: `There is no memory ${id} among the playbook's memories or its organization's`,
  });
});

const lineageErased = Effect.fnUntraced(function* (ports: MemoryPorts, first: MemoryAt, { place, acting }: Forgetting) {
  const waiting: MemoryAt[] = [first];
  const seen = new Set<string>([memoryStreamOf(first)]);
  for (let at = waiting.shift(); at !== undefined; at = waiting.shift()) {
    const linked = yield* keeperOf(ports, place, at).erased(at, acting);
    for (const each of linked.filter((link) => !seen.has(memoryStreamOf(link)))) {
      seen.add(memoryStreamOf(each));
      waiting.push(each);
    }
  }
});

export const forgotten = Effect.fnUntraced(function* (
  ports: MemoryPorts,
  at: MemoryAt,
  erase: boolean,
  forgetting: Forgetting,
) {
  const { id, scope } = at;
  if (erase) {
    yield* lineageErased(ports, at, forgetting);
    const erased: Forgotten = { id, scope, status: 'erased' };
    return erased;
  }
  const status = yield* keeperOf(ports, forgetting.place, at).forgotten(at, forgetting.acting);
  const answer: Forgotten = { id, scope, status };
  return answer;
});

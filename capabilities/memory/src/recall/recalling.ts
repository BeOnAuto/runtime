import { Effect } from 'effect';

import { keeperOf, organizationKept, type MemoryPorts } from '../capability/memory-ports.ts';
import type { RecallScope } from '../document/memory-scopes.ts';
import type { MemoryScope } from '../facts/memory-facts.ts';
import { addressOfScope, type MemoryPlace } from '../facts/memory-streams.ts';
import { keptMemoryOf, type KeptMemory } from '../projection/memory-row-reading.ts';
import { rankedMemories, wordsIn } from './memory-matching.ts';

export interface RecallAsked {
  readonly words: string;
  readonly tags: readonly string[];
  readonly scope: RecallScope;
  readonly mostCharacters: number;
}

type RecalledMemory = {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly text: string;
  readonly tags: readonly string[];
  readonly about?: { readonly from: string; readonly to: string };
  readonly written_at: string;
  readonly written_by: string;
};

type Recalled = {
  readonly memories: readonly RecalledMemory[];
};

export interface RecallMade {
  readonly recalled: Recalled;
  readonly examined: number;
}

const scopesRecalled: Readonly<Record<RecallScope, readonly MemoryScope[]>> = {
  playbook: ['playbook'],
  organization: ['organization'],
  both: ['playbook', 'organization'],
};

function rowsExaminedIn(
  ports: MemoryPorts,
  place: MemoryPlace,
  scope: MemoryScope,
): Effect.Effect<readonly KeptMemory[]> {
  const query = {
    where: [{ column: 'status', equals: 'kept' }],
    orderBy: ['written_at'],
    order: 'desc',
    limit: ports.mostExamined,
  } as const;
  return Effect.map(keeperOf(ports, place, { place, scope }).rowsRead(addressOfScope(place, scope), query), (rows) =>
    rows.map((row) => keptMemoryOf(row)),
  );
}

function recalledOf({ id, scope, text, tags, about, writtenAt, writtenBy }: KeptMemory): RecalledMemory {
  return {
    id,
    scope,
    text,
    tags,
    ...(about === undefined ? {} : { about }),
    written_at: writtenAt,
    written_by: writtenBy,
  };
}

export function recalled(
  ports: MemoryPorts,
  place: MemoryPlace,
  { words, tags, scope, mostCharacters }: RecallAsked,
  now: string,
): Effect.Effect<RecallMade> {
  return Effect.map(
    Effect.forEach(
      scopesRecalled[scope].filter((each) => organizationKept(ports) || each === 'playbook'),
      (each) => rowsExaminedIn(ports, place, each),
    ),
    (examinedByScope: readonly (readonly KeptMemory[])[]) => {
      const rowsExamined = examinedByScope.flat();
      const ranked = rankedMemories(rowsExamined, { words: wordsIn(words), tags, mostCharacters, now });
      return { recalled: { memories: ranked.map((memory) => recalledOf(memory)) }, examined: rowsExamined.length };
    },
  );
}

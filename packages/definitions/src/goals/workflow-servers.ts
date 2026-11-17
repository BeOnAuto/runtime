import type { PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { loadRegistry } from '../operations/registry-access.ts';
import { textAsRead, type TextAsRead } from '../payloads/kept-texts.ts';
import { serversNamedBy } from '../portable/portable-export.ts';
import type { DefinitionRegistry, RegisteredDefinition } from '../registry/definition-registry.ts';
import { isRetired } from '../registry/definition.ts';
import type { NamedDefinition } from '../used-by/called-definitions.ts';
import { namingDetailsOf } from '../used-by/definition-users.ts';

export const mostCallDepth = 4;

type Read<A> = Effect.Effect<A, never, PlaybookReader | PlaybookContext>;

interface Registries {
  readonly of: (type: string) => Read<DefinitionRegistry>;
}

function registriesKept(): Registries {
  const kept = new Map<string, DefinitionRegistry>();
  return {
    of: (type) => {
      const known = kept.get(type);
      return known === undefined
        ? Effect.tap(loadRegistry(type), (registry) => Effect.sync(() => kept.set(type, registry)))
        : Effect.succeed(known);
    },
  };
}

interface Visit {
  readonly named: NamedDefinition;
  readonly depth: number;
}

function keyOf({ type, name }: NamedDefinition): string {
  return `${type}/${name}`;
}

export function serversOfTheSource(type: string, read: TextAsRead): readonly string[] {
  return 'text' in read ? serversNamedBy({ type, source: read.text }) : [];
}

function serversOfOne(type: string, stored: RegisteredDefinition): Read<readonly string[]> {
  return Effect.map(textAsRead('source', stored.source), (read) => serversOfTheSource(type, read));
}

function calledBy(stored: RegisteredDefinition, depth: number): readonly Visit[] {
  const { calls = [] } = namingDetailsOf(stored.details);
  return depth >= mostCallDepth ? [] : calls.map(({ type, name }) => ({ named: { type, name }, depth: depth + 1 }));
}

function serversReached(registries: Registries, workflow: string): Read<readonly string[]> {
  const seen = new Set<string>();
  const servers = new Set<string>();
  const visited = (visit: Visit): Read<void> =>
    Effect.gen(function* () {
      if (seen.has(keyOf(visit.named))) {
        return;
      }
      seen.add(keyOf(visit.named));
      const stored = (yield* registries.of(visit.named.type)).get(visit.named.name);
      if (stored === undefined || isRetired(stored)) {
        return;
      }
      for (const server of yield* serversOfOne(visit.named.type, stored)) {
        servers.add(server);
      }
      yield* Effect.forEach(calledBy(stored, visit.depth), visited, { discard: true });
    });
  return Effect.map(visited({ named: { type: 'workflow', name: workflow }, depth: 0 }), () =>
    [...servers].toSorted((left, right) => (left < right ? -1 : 1)),
  );
}

export function workflowServersIn(workflows: readonly string[]): Read<ReadonlyMap<string, readonly string[]>> {
  const registries = registriesKept();
  return Effect.map(
    Effect.forEach(workflows, (workflow) =>
      Effect.map(serversReached(registries, workflow), (servers): readonly [string, readonly string[]] => [
        workflow,
        servers,
      ]),
    ),
    (pairs: readonly (readonly [string, readonly string[]])[]) => new Map(pairs),
  );
}

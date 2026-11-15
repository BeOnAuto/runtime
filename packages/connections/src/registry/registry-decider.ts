import { streamPrefixOfOrg, type Decider, type Fold } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';

import type { ConnectionCommand } from './connection-commands.ts';
import { ConnectionEventSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { factsAsNamedIn } from './facts-as-named.ts';
import { decideOnRegistry, registryContextOf, type RegistryRefusal } from './registry-decisions.ts';
import { evolveRegistry, initialRegistry, type Registry } from './registry.ts';

export const connectionsStream = 'connections';

export const byTheRuntime = 'runtime';

export function connectionsStreamOfOrg(org: string): string {
  return `${streamPrefixOfOrg({ org })}${connectionsStream}`;
}

type RegistryDecider = Decider<Registry, ConnectionCommand, RecordedConnectionEvent, RegistryRefusal>;

export function connectionsFoldOf(providers: ProviderList): Fold<Registry, RecordedConnectionEvent> {
  const asNamed = factsAsNamedIn(providers);
  return {
    initialState: initialRegistry,
    evolve: (registry, fact) => evolveRegistry(registry, asNamed(fact)),
    eventSchema: ConnectionEventSchema,
  };
}

export function registryDeciderOf(providers: ProviderList): RegistryDecider {
  return { ...connectionsFoldOf(providers), decide: decideOnRegistry, context: registryContextOf };
}

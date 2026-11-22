import { streamPrefixOfOrg, type Decider, type Fold } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';

import type { ConnectionCommand } from './connection-commands.ts';
import { ConnectionEventSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { decideApart, isDecidedApart } from './decided-apart.ts';
import { factsAsReadIn } from './facts-as-named.ts';
import { decideOnRegistry, registryContextOf, type RegistryRefusal } from './registry-decisions.ts';
import { evolveRegistry, initialRegistry, type Registry } from './registry.ts';

export const connectionsStream = 'connections';

export const byTheRuntime = 'runtime';

export function connectionsStreamOfOrg(org: string): string {
  return `${streamPrefixOfOrg({ org })}${connectionsStream}`;
}

type RegistryDecider = Decider<Registry, ConnectionCommand, RecordedConnectionEvent, RegistryRefusal>;

export function connectionsFoldOf(providers: ProviderList): Fold<Registry, RecordedConnectionEvent> {
  const asRead = factsAsReadIn(providers);
  return {
    initialState: initialRegistry,
    evolve: (registry, fact) => evolveRegistry(registry, asRead(fact)),
    eventSchema: ConnectionEventSchema,
  };
}

function decidedWith(providers: ProviderList): RegistryDecider['decide'] {
  return (command, registry) =>
    isDecidedApart(command) ? decideApart(command, registry, providers) : decideOnRegistry(command, registry);
}

export function registryDeciderOf(providers: ProviderList): RegistryDecider {
  return { ...connectionsFoldOf(providers), decide: decidedWith(providers), context: registryContextOf };
}

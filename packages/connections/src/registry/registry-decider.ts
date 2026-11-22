import { streamPrefixOfOrg, type Decider, type Fold } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';

import { decideAppCredentialRefusal } from './app-credential-decisions.ts';
import type { ConnectionCommand } from './connection-commands.ts';
import { ConnectionEventSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { factsAsReadIn } from './facts-as-named.ts';
import { decideIdentification } from './identity-decisions.ts';
import { decideOnRegistry, registryContextOf, type RegistryRefusal } from './registry-decisions.ts';
import { evolveRegistry, initialRegistry, type Registry } from './registry.ts';
import { decideOnItsWay } from './way-decisions.ts';

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
  return (command, registry) => {
    if (command.type === 'refuse_app_credential') {
      return decideAppCredentialRefusal(command, registry);
    }
    if (command.type === 'set_account_type' || command.type === 'choose_way') {
      return decideOnItsWay(command, registry, providers);
    }
    return command.type === 'identify' ? decideIdentification(command, registry) : decideOnRegistry(command, registry);
  };
}

export function registryDeciderOf(providers: ProviderList): RegistryDecider {
  return { ...connectionsFoldOf(providers), decide: decidedWith(providers), context: registryContextOf };
}

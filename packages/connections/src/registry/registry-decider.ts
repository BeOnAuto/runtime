import { streamPrefixOfOrg, type Decider, type Fold } from '@on.auto/operations';

import type { ConnectionCommand } from './connection-commands.ts';
import { ConnectionEventSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { decideOnRegistry, registryContextOf, type RegistryRefusal } from './registry-decisions.ts';
import { evolveRegistry, initialRegistry, type Registry } from './registry.ts';

export const connectionsStream = 'connections';

export const byTheRuntime = 'runtime';

export function connectionsStreamOfOrg(org: string): string {
  return `${streamPrefixOfOrg({ org })}${connectionsStream}`;
}

export const registryDecider: Decider<Registry, ConnectionCommand, RecordedConnectionEvent, RegistryRefusal> = {
  initialState: initialRegistry,
  evolve: evolveRegistry,
  decide: decideOnRegistry,
  context: registryContextOf,
  eventSchema: ConnectionEventSchema,
};

export const connectionsFold: Fold<Registry, RecordedConnectionEvent> = {
  initialState: initialRegistry,
  evolve: evolveRegistry,
  eventSchema: ConnectionEventSchema,
};

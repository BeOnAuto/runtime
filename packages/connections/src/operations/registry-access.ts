import {
  Caller,
  OrgReader,
  OrgWriter,
  randomUUIDv7,
  recordedCallerOf,
  type NotFound,
  type RecordedCaller,
} from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import type { GivenAddition } from '../providers/provider-additions.ts';
import type { ConnectionAddition, ConnectionCommandData } from '../registry/connection-commands.ts';
import { connectionsStream, registryDecider } from '../registry/registry-decider.ts';
import { findConnection } from '../registry/registry-lookup.ts';
import type { KeptConnection, OpenLink, Registry } from '../registry/registry.ts';

export const loadRegistry: Effect.Effect<Registry, never, OrgReader> = Effect.gen(function* () {
  const { state } = yield* (yield* OrgReader).load(connectionsStream, registryDecider);
  return state;
});

export function foundConnection(id: string): Effect.Effect<KeptConnection, NotFound, OrgReader> {
  return loadRegistry.pipe(Effect.flatMap((registry) => findConnection(registry, id)));
}

export const recordedCaller = Effect.map(Effect.service(Caller), recordedCallerOf);

export const actedNow = Effect.gen(function* () {
  const { id: by } = yield* Caller;
  return { by, at: DateTime.formatIso(yield* DateTime.now) };
});

export function additionOf(
  { name, type, provider, placeholders, entry, credential }: GivenAddition,
  link: OpenLink,
  addedBy: RecordedCaller,
): ConnectionAddition {
  return {
    type: 'add',
    connection: randomUUIDv7(),
    name,
    server_type: type,
    provider,
    placeholders,
    entry,
    credential,
    added_by: addedBy,
    link,
  };
}

export const recordInRegistry = Effect.fnUntraced(function* (data: ConnectionCommandData) {
  const acted = yield* actedNow;
  const { state } = yield* (yield* OrgWriter).execute(connectionsStream, registryDecider, { ...data, ...acted });
  return yield* Effect.orDie(findConnection(state, data.connection));
});

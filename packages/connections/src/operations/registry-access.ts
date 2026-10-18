import { Caller, OrgReader, OrgWriter, randomUUIDv7, type NotFound } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import type { AdditionInput } from '../entries/entry-checks.ts';
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

export const actedNow = Effect.gen(function* () {
  const { id: by } = yield* Caller;
  return { by, at: DateTime.formatIso(yield* DateTime.now) };
});

export function additionOf({ name, type, entry, credential }: AdditionInput, link: OpenLink): ConnectionAddition {
  return { type: 'add', connection: randomUUIDv7(), name, server_type: type, entry, credential, link };
}

export const recordInRegistry = Effect.fnUntraced(function* (data: ConnectionCommandData) {
  const acted = yield* actedNow;
  const { state } = yield* (yield* OrgWriter).execute(connectionsStream, registryDecider, { ...data, ...acted });
  return yield* Effect.orDie(findConnection(state, data.connection));
});

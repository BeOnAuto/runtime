import {
  Caller,
  OrgReader,
  OrgWriter,
  randomUUIDv7,
  recordedCallerOf,
  type NotFound,
  type OfferedLink,
  type RecordedCaller,
} from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import { tokenSha256OfPage } from '../links/link-token.ts';
import type { GivenAddition } from '../providers/provider-additions.ts';
import type {
  ClientGiving,
  ConnectionAddition,
  ConnectionCommandData,
  ConsentFinish,
  ConsentStart,
  CredentialGiving,
} from '../registry/connection-commands.ts';
import { connectionsStream, registryDecider } from '../registry/registry-decider.ts';
import { findConnection } from '../registry/registry-lookup.ts';
import type { KeptConnection, OpenLink, Registry } from '../registry/registry.ts';
import type { SecretKeeping } from './connection-services.ts';
import { shownConnection } from './shown-connections.ts';

export const loadRegistry: Effect.Effect<Registry, never, OrgReader> = Effect.gen(function* () {
  const { state } = yield* (yield* OrgReader).load(connectionsStream, registryDecider);
  return state;
});

export function foundConnection(id: string): Effect.Effect<KeptConnection, NotFound, OrgReader> {
  return loadRegistry.pipe(Effect.flatMap((registry) => findConnection(registry, id)));
}

export const recordedCaller = Effect.map(Effect.service(Caller), recordedCallerOf);

interface OfferStanding {
  readonly connect?: { readonly url: string; readonly expires_at: string };
  readonly link_ran_out?: true;
  readonly link_replaced?: true;
}

function standingOfTheOffer({ link, replacedLinks }: KeptConnection, url: string, at: string): OfferStanding {
  if (link === undefined) {
    return {};
  }
  const offered = tokenSha256OfPage(url);
  const isOpen = link.expires_at > at;
  if (link.token_sha256 === offered) {
    return isOpen ? { connect: { url, expires_at: link.expires_at } } : { link_ran_out: true };
  }
  return isOpen && replacedLinks.has(offered) ? { link_replaced: true } : {};
}

export const standingAfterTheLink = Effect.fnUntraced(function* (
  secrets: Pick<SecretKeeping, 'endingsOf'>,
  { id, url }: OfferedLink,
) {
  const kept = yield* Effect.orDie(foundConnection(id));
  const connection = yield* shownConnection(secrets, kept);
  return { ...connection, ...standingOfTheOffer(kept, url, DateTime.formatIso(yield* DateTime.now)) };
});

export const actedNow = Effect.gen(function* () {
  const { id: by } = yield* Caller;
  return { by, at: DateTime.formatIso(yield* DateTime.now) };
});

export function additionOf(
  { name, type, provider, placeholders, entry, credential, says = {} }: GivenAddition,
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
    says,
    added_by: addedBy,
    link,
  };
}

const executedInRegistry = Effect.fnUntraced(function* (data: ConnectionCommandData) {
  const acted = yield* actedNow;
  return yield* (yield* OrgWriter).execute(connectionsStream, registryDecider, { ...data, ...acted });
});

export const recordInRegistry = Effect.fnUntraced(function* (data: ConnectionCommandData) {
  const { state } = yield* executedInRegistry(data);
  return yield* Effect.orDie(findConnection(state, data.connection));
});

type Replacing = CredentialGiving | ClientGiving | ConsentStart | ConsentFinish;

export const recordChangeInRegistry = Effect.fnUntraced(function* (data: Replacing) {
  const { state, decidedOn } = yield* executedInRegistry(data);
  return {
    before: yield* Effect.orDie(findConnection(decidedOn, data.connection)),
    after: yield* Effect.orDie(findConnection(state, data.connection)),
  };
});

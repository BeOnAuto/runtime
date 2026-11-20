import {
  Caller,
  Forbidden,
  OrgReader,
  OrgWriter,
  randomUUIDv7,
  recordedCallerOf,
  type NotFound,
  type OfferedLink,
  type RecordedCaller,
} from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import type { DescribedAddition } from '../entries/described-entries.ts';
import { tokenSha256OfPage } from '../links/link-token.ts';
import type {
  ClientGiving,
  ConnectionAddition,
  ConnectionCommandData,
  ConnectionReplacement,
  ConsentFinish,
  ConsentStart,
  CredentialGiving,
  SigningSecretRemoval,
  SigningSecretSetting,
} from '../registry/connection-commands.ts';
import { connectionsStream, registryDeciderOf } from '../registry/registry-decider.ts';
import { findConnection } from '../registry/registry-lookup.ts';
import type { KeptConnection, OpenLink, Registry } from '../registry/registry.ts';
import type { ConnectionServices, SecretKeeping } from './connection-services.ts';
import { shownConnection } from './shown-connections.ts';

type Named = Pick<ConnectionServices, 'providers'>;

export function loadRegistry({ providers }: Named): Effect.Effect<Registry, never, OrgReader> {
  return Effect.gen(function* () {
    const { state } = yield* (yield* OrgReader).load(connectionsStream, registryDeciderOf(providers));
    return state;
  });
}

export function foundConnection(named: Named, id: string): Effect.Effect<KeptConnection, NotFound, OrgReader> {
  return loadRegistry(named).pipe(Effect.flatMap((registry) => findConnection(registry, id)));
}

export const recordedCaller = Effect.map(Effect.service(Caller), recordedCallerOf);

const limitedToSomePlaybooks = new Forbidden({
  detail:
    'The caller may access only some playbooks of this org, so it cannot change which playbooks may use a connection',
});

export const mayChoosePlaybooks: Effect.Effect<void, Forbidden, Caller> = Effect.flatMap(
  Effect.service(Caller),
  ({ playbooks }) => (playbooks === '*' ? Effect.void : Effect.fail(limitedToSomePlaybooks)),
);

export function allowedToChoose(
  playbooks: readonly string[] | null | undefined,
): Effect.Effect<void, Forbidden, Caller> {
  return playbooks === undefined ? Effect.void : mayChoosePlaybooks;
}

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
  { secrets, providers }: Named & { readonly secrets: Pick<SecretKeeping, 'endingsOf'> },
  { id, url }: OfferedLink,
) {
  const kept = yield* Effect.orDie(foundConnection({ providers }, id));
  const connection = yield* shownConnection(secrets, kept);
  return { ...connection, ...standingOfTheOffer(kept, url, DateTime.formatIso(yield* DateTime.now)) };
});

export const actedNow = Effect.gen(function* () {
  const { id: by } = yield* Caller;
  return { by, at: DateTime.formatIso(yield* DateTime.now) };
});

export function additionOf(
  { name, type, provider, placeholders, entry, document, credential, says = {}, events }: DescribedAddition,
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
    ...(document === undefined ? {} : { document }),
    credential,
    says,
    ...(events === undefined ? {} : { events }),
    added_by: addedBy,
    link,
  };
}

const executedInRegistry = Effect.fnUntraced(function* ({ providers }: Named, data: ConnectionCommandData) {
  const acted = yield* actedNow;
  return yield* (yield* OrgWriter).execute(connectionsStream, registryDeciderOf(providers), { ...data, ...acted });
});

export const recordInRegistry = Effect.fnUntraced(function* (named: Named, data: ConnectionCommandData) {
  const { state } = yield* executedInRegistry(named, data);
  return yield* Effect.orDie(findConnection(state, data.connection));
});

type Replacing =
  | CredentialGiving
  | ClientGiving
  | ConsentStart
  | ConsentFinish
  | SigningSecretSetting
  | SigningSecretRemoval;

export const recordChangeInRegistry = Effect.fnUntraced(function* (named: Named, data: Replacing) {
  const { state, decidedOn } = yield* executedInRegistry(named, data);
  return {
    before: yield* Effect.orDie(findConnection(decidedOn, data.connection)),
    after: yield* Effect.orDie(findConnection(state, data.connection)),
  };
});

export const recordReplacementInRegistry = Effect.fnUntraced(function* (named: Named, data: ConnectionReplacement) {
  const { state } = yield* executedInRegistry(named, data);
  return {
    removed: yield* Effect.orDie(findConnection(state, data.connection)),
    added: yield* Effect.orDie(findConnection(state, data.addition.connection)),
  };
});

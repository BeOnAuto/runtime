import { required } from '@on.auto/operations';
import type { Conflict, Forbidden, InvalidInput } from '@on.auto/operations';
import type { NamedWay, WayRefusal } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { credentialUnnamedOf, takesConsentOf, wayRefusalOf, type WayRefused } from '../page/consent-words.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import { checkedAdditionOf, refusalOfTheAddition, type GivenAddition } from '../providers/provider-additions.ts';
import type { Credential, CredentialKind } from '../registry/credential.ts';
import type { AdditionGiven } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';

type Admitting = Pick<
  ConnectionServices,
  'policy' | 'fileEntries' | 'modelProviders' | 'providers' | 'providerValues' | 'consent' | 'resolve'
> & {
  readonly org: string;
  readonly studioBase: string;
};

type WayNaming = Pick<ConnectionServices, 'policy' | 'consent' | 'resolve'>;

type KindGiven = CredentialKind | 'left_out';

interface Asked {
  readonly addition: GivenAddition;
  readonly kind: KindGiven;
  readonly url: string;
}

function isAskedHowItAuthenticates({ provider, type }: GivenAddition): boolean {
  return provider === null && type === 'mcp';
}

function credentialOf({ issuer, clients, scope }: NamedWay): Credential {
  return { kind: 'authorization', issuer, clients, ...(scope === undefined ? {} : { scope }) };
}

function takesTheWayItNames(kind: KindGiven): boolean {
  return kind === 'left_out' || kind === 'authorization';
}

function withTheWayNamed({ addition, kind, url }: Asked, named: NamedWay): Effect.Effect<GivenAddition, InvalidInput> {
  if (takesTheWayItNames(kind)) {
    return Effect.succeed({ ...addition, credential: credentialOf(named) });
  }
  return kind === 'client_credentials' ? Effect.succeed(addition) : Effect.fail(takesConsentOf(url, named.issuer));
}

function cannotBeAsked({ refused }: WayRefusal): boolean {
  return refused === 'host' || refused === 'unanswered';
}

function namesItsAuthorizationServer({ refused }: WayRefusal): boolean {
  return refused === 'at_the_issuer' || refused === 'malformed_scope';
}

function keepsItsKind(kind: KindGiven, refusal: WayRefusal): boolean {
  if (takesTheWayItNames(kind) || cannotBeAsked(refusal)) {
    return false;
  }
  return kind === 'client_credentials' || !namesItsAuthorizationServer(refusal);
}

function withNoWayNamed({ addition, kind, url }: Asked, refusal: WayRefusal): Effect.Effect<GivenAddition, WayRefused> {
  if (kind === 'left_out' && refusal.refused === 'no_authorization_server') {
    return Effect.fail(credentialUnnamedOf(url));
  }
  return keepsItsKind(kind, refusal) ? Effect.succeed(addition) : Effect.fail(wayRefusalOf(url, refusal));
}

function askedHowItAuthenticates(
  addition: GivenAddition,
  given: AdditionGiven,
  { consent, policy, resolve }: WayNaming,
): Effect.Effect<GivenAddition, WayRefused> {
  if (!isAskedHowItAuthenticates(addition)) {
    return Effect.succeed(addition);
  }
  const asked: Asked = { addition, kind: given.credential?.kind ?? 'left_out', url: required(addition.entry.url) };
  return consent.namedWay({ url: asked.url, reaches: reachesUnder(policy, resolve) }).pipe(
    Effect.matchEffect({
      onSuccess: (named) => withTheWayNamed(asked, named),
      onFailure: (refusal) => withNoWayNamed(asked, refusal),
    }),
  );
}

export function admittedAdditionOf(
  given: AdditionGiven,
  admitting: Admitting,
): Effect.Effect<GivenAddition, InvalidInput | Forbidden | Conflict | WayRefused> {
  const { org, modelProviders, policy, fileEntries } = admitting;
  return Effect.gen(function* () {
    const checked = yield* checkedAdditionOf(given, { org, modelProviders }, admitting);
    const refusal = refusalOfTheAddition(checked, policy, fileEntries, admitting);
    if (refusal !== undefined) {
      return yield* Effect.fail(refusal);
    }
    return yield* askedHowItAuthenticates(checked, given, admitting);
  });
}

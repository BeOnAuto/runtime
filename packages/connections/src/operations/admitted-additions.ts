import { required } from '@on.auto/operations';
import type { Conflict, Forbidden, InvalidInput } from '@on.auto/operations';
import type { NamedWay } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { wayRefusalOf, type WayRefused } from '../page/consent-words.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import { checkedAdditionOf, refusalOfTheAddition, type GivenAddition } from '../providers/provider-additions.ts';
import type { Credential } from '../registry/credential.ts';
import type { AdditionGiven } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';

type Admitting = Pick<
  ConnectionServices,
  'policy' | 'fileEntries' | 'modelProviders' | 'providers' | 'providerValues' | 'consent'
> & {
  readonly org: string;
  readonly studioBase: string;
};

type WayNaming = Pick<ConnectionServices, 'policy' | 'consent'>;

function takesTheWayItNames({ provider, credential }: GivenAddition): boolean {
  return provider === null && credential.kind === 'authorization';
}

function credentialOf({ issuer, clients, scope }: NamedWay): Credential {
  return { kind: 'authorization', issuer, clients, ...(scope === undefined ? {} : { scope }) };
}

function withTheWayItNames(
  addition: GivenAddition,
  { consent, policy }: WayNaming,
): Effect.Effect<GivenAddition, WayRefused> {
  if (!takesTheWayItNames(addition)) {
    return Effect.succeed(addition);
  }
  const url = required(addition.entry.url);
  return consent.namedWay({ url, reaches: reachesUnder(policy) }).pipe(
    Effect.map((named): GivenAddition => ({ ...addition, credential: credentialOf(named) })),
    Effect.mapError((refusal) => wayRefusalOf(url, refusal)),
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
    return yield* withTheWayItNames(checked, admitting);
  });
}

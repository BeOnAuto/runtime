import { InvalidInput, type Issue } from '@on.auto/operations';
import { listed } from '@on.auto/phrasing';
import {
  additionOfProvider,
  isAManagedServiceAccount,
  isTheWayAsked,
  type CredentialWay,
  type Provider,
} from '@on.auto/providers';
import { JsonPointer, Result } from 'effect';

import type { RecordedConnection } from '../registry/connection.ts';
import type { WayAsked } from '../registry/way-decisions.ts';
import { gatewayUnofferedOf, isOfferedWay, oauthClientForOf, waysInOrderOf, type Listing } from './provider-listing.ts';

export interface ChosenCredential {
  readonly credential: RecordedConnection['credential'];
  readonly says: Readonly<Record<string, string>>;
  readonly placeholders?: Readonly<Record<string, string>>;
  readonly base_url?: string | null;
}

type Chosen = Pick<RecordedConnection, 'name' | 'placeholders'>;

type Values = Readonly<Record<string, string>>;

function cannotConnectThisWay({ name }: Chosen, issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({ detail: `The connection ${name} cannot connect this way.`, issues });
}

export function valuesUnaskedBy(given: Values | undefined, taken: readonly string[]): readonly Issue[] {
  const takes = taken.length === 0 ? 'none' : listed(taken);
  return Object.keys(given ?? {})
    .filter((name) => !taken.includes(name))
    .map((name) => ({
      pointer: `/placeholders/${JsonPointer.escapeToken(name)}`,
      detail: `The way chosen takes no value named ${name}; it takes ${takes}.`,
    }));
}

function gatewayIssuesOf(named: Provider, { credential }: ChosenCredential, listing: Listing): readonly Issue[] {
  const unoffered = credential.client_source === 'gateway' ? gatewayUnofferedOf(named, listing) : undefined;
  return unoffered === undefined ? [] : [{ pointer: '/credential', detail: unoffered }];
}

function heldOf(held: Values | null, names: readonly string[]): Values {
  return Object.fromEntries(
    Object.entries(held ?? {}).filter(([name]: readonly [string, string]) => names.includes(name)),
  );
}

function valuesFor(named: Provider, ways: readonly CredentialWay[], connection: Chosen, given: Values | undefined) {
  const ofTheWay = ways
    .filter((way) => !isAManagedServiceAccount(way))
    .flatMap(({ placeholders = {} }) => Object.keys(placeholders));
  const ofTheEntry = heldOf(connection.placeholders, Object.keys(named.entry.placeholders ?? {}));
  return { taken: ofTheWay, values: { ...ofTheEntry, ...(given ?? heldOf(connection.placeholders, ofTheWay)) } };
}

function resolvedWith(
  named: Provider,
  connection: Chosen,
  { credential: asked, placeholders: given }: WayAsked,
  listing: Listing,
): Result.Result<ChosenCredential, readonly Issue[]> {
  const credentials = waysInOrderOf(named, listing).filter((way) => isTheWayAsked(way, asked));
  const { taken, values } = valuesFor(named, credentials, connection, given);
  const unasked = valuesUnaskedBy(given, taken);
  if (unasked.length > 0) {
    return Result.fail(unasked);
  }
  const addition = additionOfProvider(
    { ...named.entry, credentials },
    {
      placeholders: values,
      kind: asked.kind,
      oauthClientFor: oauthClientForOf(named, listing),
      canBeGiven: (way) => isOfferedWay(named, way, listing),
    },
  );
  return Result.map(addition, ({ credential, permissions, says = {}, placeholders, entry }) => ({
    credential: { ...credential, ...(permissions === undefined ? {} : { permissions }) },
    says,
    placeholders,
    base_url: entry.base_url ?? null,
  }));
}

export function providerCredentialChosen(
  named: Provider,
  connection: Chosen,
  asked: WayAsked,
  listing: Listing,
): Result.Result<ChosenCredential, InvalidInput> {
  return Result.match(resolvedWith(named, connection, asked, listing), {
    onFailure: (issues) => Result.fail(cannotConnectThisWay(connection, issues)),
    onSuccess: (chosen) => {
      const issues = gatewayIssuesOf(named, chosen, listing);
      return issues.length === 0 ? Result.succeed(chosen) : Result.fail(cannotConnectThisWay(connection, issues));
    },
  });
}

import { Conflict, InvalidInput } from '@on.auto/operations';
import { alternatives, quoted } from '@on.auto/phrasing';
import {
  providerNamed,
  scopeWith,
  scopesIn,
  type CredentialWay,
  type ProviderList,
  type ScopeGroup,
} from '@on.auto/providers';
import { Function, Result } from 'effect';

import type { RecordedConnection, SaidScope } from '../registry/connection.ts';

type OfAWay = Pick<RecordedConnection, 'provider' | 'credential'>;

type OfAProvider = Pick<RecordedConnection, 'name' | 'provider' | 'credential'>;

type Holding = Pick<RecordedConnection, 'asked_scopes' | 'granted_scope'>;

type HoldingOfAWay = OfAWay & Holding;

export interface AskedMore {
  readonly group: ScopeGroup;
  readonly scope: string;
  readonly says: Readonly<Record<string, string>>;
}

export interface AskedAgain {
  readonly scope: string | undefined;
  readonly scopeOfTheWay: string | undefined;
  readonly says: Readonly<Record<string, string>>;
}

interface WayAsItStands {
  readonly scope: string | undefined;
  readonly says: Readonly<Record<string, string>>;
  readonly names: (scope: string) => boolean;
}

function wayOf({ provider, credential }: OfAWay, providers: ProviderList): CredentialWay | undefined {
  return provider === null
    ? undefined
    : Result.getOrUndefined(
        Result.map(providerNamed(providers, provider), ({ entry }) =>
          entry.credentials.find(({ kind }) => kind === credential.kind),
        ),
      );
}

function groupsOf(connection: OfAWay, providers: ProviderList): readonly ScopeGroup[] {
  return wayOf(connection, providers)?.more ?? [];
}

function scopesNamedBy({ scope, more = [] }: CredentialWay): ReadonlySet<string> {
  return new Set([scope, ...more.map((group) => group.scope)].flatMap((named) => scopesIn(named)));
}

function wayAsItStandsOf(connection: OfAWay, providers: ProviderList): WayAsItStands {
  const way = wayOf(connection, providers);
  if (way === undefined) {
    return { scope: connection.credential.scope, says: {}, names: Function.constTrue };
  }
  const named = scopesNamedBy(way);
  return { scope: way.scope, says: way.says ?? {}, names: (scope) => named.has(scope) };
}

export function groupNamed(connection: OfAWay, providers: ProviderList, name: string): ScopeGroup | undefined {
  return groupsOf(connection, providers).find((group) => group.name === name);
}

function grantedOfWhatWasAsked(
  { asked_scopes: asked, granted_scope: granted }: Holding,
  { names }: WayAsItStands,
): string | undefined {
  const held = new Set(scopesIn(granted ?? undefined));
  const kept = asked.map(({ name }) => name).filter((name) => held.has(name) && names(name));
  return kept.length === 0 ? undefined : kept.join(' ');
}

function heldScopeOf(connection: Holding, way: WayAsItStands): string | undefined {
  return grantedOfWhatWasAsked(connection, way) ?? way.scope;
}

function wordsNotAskedOf(
  { asked_scopes: asked }: Holding,
  says: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const named = new Set(asked.map(({ name }) => name));
  return Object.fromEntries(Object.entries(says).filter(([scope]: readonly [string, string]) => !named.has(scope)));
}

export function askedAgainOf(connection: HoldingOfAWay, providers: ProviderList): AskedAgain {
  const way = wayAsItStandsOf(connection, providers);
  const granted = grantedOfWhatWasAsked(connection, way);
  return {
    scope: granted === undefined ? way.scope : scopeWith(way.scope, granted),
    scopeOfTheWay: way.scope,
    says: wordsNotAskedOf(connection, way.says),
  };
}

export function scopesStillNamedOf(
  connection: OfAWay,
  providers: ProviderList,
  scopes: readonly SaidScope[],
): readonly SaidScope[] {
  const { names } = wayAsItStandsOf(connection, providers);
  return scopes.filter(({ name }) => names(name));
}

export function noLongerNamed({ name }: OfAProvider, more: string): Conflict {
  return new Conflict({
    detail: `The provider of the connection ${name} no longer names ${quoted(more)} among what its connections may be granted later, so this link cannot ask it; reconnect the connection for a new link`,
  });
}

function namesOf(groups: readonly ScopeGroup[]): string {
  return groups.length === 0 ? 'none' : alternatives(groups.map(({ name }) => quoted(name)));
}

export type MoreAskedBy = 'added' | 'reconnected';

export function unnamedGroupOf(connection: OfAProvider, providers: ProviderList, askedBy: MoreAskedBy): InvalidInput {
  return new InvalidInput({
    detail: `The connection cannot be ${askedBy} as it is given`,
    issues: [
      {
        pointer: '/more',
        detail: `Expected a group the way of the connection ${connection.name} names in more, which is ${namesOf(groupsOf(connection, providers))}`,
      },
    ],
  });
}

function askedFor(connection: Holding, group: ScopeGroup, way: WayAsItStands): AskedMore {
  return {
    group,
    scope: scopeWith(heldScopeOf(connection, way), group.scope),
    says: wordsNotAskedOf(connection, group.says),
  };
}

export function moreAskedOf(connection: HoldingOfAWay, providers: ProviderList, more: string): AskedMore | undefined {
  const group = groupNamed(connection, providers, more);
  return group === undefined ? undefined : askedFor(connection, group, wayAsItStandsOf(connection, providers));
}

export function moreStillAskedOf(connection: HoldingOfAWay, providers: ProviderList): readonly AskedMore[] {
  const way = wayAsItStandsOf(connection, providers);
  const held = new Set(scopesIn(connection.granted_scope ?? undefined));
  return groupsOf(connection, providers)
    .filter(({ scope }) => scopesIn(scope).some((name) => !held.has(name)))
    .map((group) => askedFor(connection, group, way));
}

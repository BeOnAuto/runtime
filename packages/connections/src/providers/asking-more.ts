import { Conflict, InvalidInput, alternatives, quoted } from '@on.auto/operations';
import { providerNamed, scopeWith, scopesIn, type ProviderList, type ScopeGroup } from '@on.auto/providers';
import { Result } from 'effect';

import type { RecordedConnection } from '../registry/connection.ts';

type OfAProvider = Pick<RecordedConnection, 'name' | 'provider' | 'credential'>;

type Holding = Pick<RecordedConnection, 'credential' | 'asked_scopes' | 'granted_scope'>;

type HoldingOfAProvider = OfAProvider & Holding;

export interface AskedMore {
  readonly group: ScopeGroup;
  readonly scope: string;
  readonly says: Readonly<Record<string, string>>;
}

function groupsOf({ provider, credential }: OfAProvider, providers: ProviderList): readonly ScopeGroup[] {
  const way =
    provider === null
      ? undefined
      : Result.getOrUndefined(
          Result.map(providerNamed(providers, provider), ({ entry }) =>
            entry.credentials.find(({ kind }) => kind === credential.kind),
          ),
        );
  return way?.more ?? [];
}

export function groupNamed(connection: OfAProvider, providers: ProviderList, name: string): ScopeGroup | undefined {
  return groupsOf(connection, providers).find((group) => group.name === name);
}

function grantedOfWhatWasAsked({ asked_scopes: asked, granted_scope: granted }: Holding): string | undefined {
  const held = new Set(scopesIn(granted ?? undefined));
  const kept = asked.map(({ name }) => name).filter((name) => held.has(name));
  return kept.length === 0 ? undefined : kept.join(' ');
}

function heldScopeOf(connection: Holding): string | undefined {
  return grantedOfWhatWasAsked(connection) ?? connection.credential.scope;
}

export function keptAskedOf(connection: Holding): string | undefined {
  const granted = grantedOfWhatWasAsked(connection);
  return granted === undefined ? connection.credential.scope : scopeWith(connection.credential.scope, granted);
}

function wordsNotAskedOf({ asked_scopes: asked }: Holding, { says }: ScopeGroup): Readonly<Record<string, string>> {
  const named = new Set(asked.map(({ name }) => name));
  return Object.fromEntries(Object.entries(says).filter(([scope]: readonly [string, string]) => !named.has(scope)));
}

export function noLongerNamed({ name }: OfAProvider, more: string): Conflict {
  return new Conflict({
    detail: `The provider of the connection ${name} no longer names ${quoted(more)} among what its connections may be granted later, so this link cannot ask it; reconnect the connection for a new link`,
  });
}

function namesOf(groups: readonly ScopeGroup[]): string {
  return groups.length === 0 ? 'none' : alternatives(groups.map(({ name }) => quoted(name)));
}

export function unnamedGroupOf(connection: OfAProvider, providers: ProviderList): InvalidInput {
  return new InvalidInput({
    detail: 'The connection cannot be reconnected as it is given',
    issues: [
      {
        pointer: '/more',
        detail: `Expected a group the way of the connection ${connection.name} names in more, which is ${namesOf(groupsOf(connection, providers))}`,
      },
    ],
  });
}

function askedFor(connection: Holding, group: ScopeGroup): AskedMore {
  return {
    group,
    scope: scopeWith(heldScopeOf(connection), group.scope),
    says: wordsNotAskedOf(connection, group),
  };
}

export function moreAskedOf(
  connection: HoldingOfAProvider,
  providers: ProviderList,
  more: string,
): AskedMore | undefined {
  const group = groupNamed(connection, providers, more);
  return group === undefined ? undefined : askedFor(connection, group);
}

export function moreStillAskedOf(connection: HoldingOfAProvider, providers: ProviderList): readonly AskedMore[] {
  const held = new Set(scopesIn(connection.granted_scope ?? undefined));
  return groupsOf(connection, providers)
    .filter(({ scope }) => scopesIn(scope).some((name) => !held.has(name)))
    .map((group) => askedFor(connection, group));
}

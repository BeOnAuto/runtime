import type { InvalidInput, Issue } from '@on.auto/operations';
import { listed } from '@on.auto/phrasing';
import {
  matchesKeyPattern,
  providerFoundBy,
  type CredentialWay,
  type EventDestination,
  type Provider,
} from '@on.auto/providers';
import { JsonPointer, Result } from 'effect';

import { opensSockets, type ConnectionServices } from '../operations/connection-services.ts';
import { offeredAppCredentialsOf, type OfferedAppCredential } from '../providers/provider-listing.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import { wayOfTheConnection } from '../registry/what-connections-act-as.ts';
import { appCredentialOutOfItsFormat, refused } from './given-fields.ts';

export interface GivenAppCredential {
  readonly name: string;
  readonly value: string;
  readonly destination: EventDestination;
  readonly failureCodes?: NonNullable<Provider['entry']['failure_codes']>;
}

interface WayOfTheConnection {
  readonly provider: Provider;
  readonly way: CredentialWay;
}

type Connecting = Pick<RecordedConnection, 'provider' | 'credential'>;

export function wayOf(
  { provider, credential }: Connecting,
  { providers }: Pick<ConnectionServices, 'providers'>,
): WayOfTheConnection | undefined {
  const found = providerFoundBy(providers, provider);
  const way = wayOfTheConnection({ provider, credential }, providers);
  return found === undefined || way === undefined ? undefined : { provider: found, way };
}

export function appCredentialPointerOf(name: string): string {
  return `/app_credentials/${JsonPointer.escapeToken(name)}`;
}

function notTakenHere(offered: readonly OfferedAppCredential[]): string {
  return offered.length === 0
    ? 'Expected no app_credentials: this connection takes none on this runtime'
    : `Expected one of the app credentials this connection takes on this runtime: ${listed(offered.map(({ credential }) => credential.name))}`;
}

function appCredentialIssueOf(
  name: string,
  value: string,
  offered: readonly OfferedAppCredential[],
): Issue | undefined {
  const declared = offered.find(({ credential }) => credential.name === name)?.credential;
  if (declared === undefined) {
    return { pointer: appCredentialPointerOf(name), detail: notTakenHere(offered) };
  }
  return declared.pattern === undefined || matchesKeyPattern(declared.pattern, value)
    ? undefined
    : { pointer: appCredentialPointerOf(name), detail: appCredentialOutOfItsFormat };
}

export function appCredentialsGivenOf(
  connection: Connecting,
  given: Readonly<Record<string, string>>,
  services: Pick<ConnectionServices, 'providers' | 'sockets'>,
): Result.Result<readonly GivenAppCredential[], InvalidInput> {
  const found = wayOf(connection, services);
  const offering = { opensSockets: opensSockets(services) };
  const offered = found === undefined ? [] : offeredAppCredentialsOf(found.provider, found.way, offering);
  const issues = Object.entries(given).flatMap(([name, value]: readonly [string, string]) => {
    const issue = appCredentialIssueOf(name, value, offered);
    return issue === undefined ? [] : [issue];
  });
  if (issues.length > 0) {
    return Result.fail(refused(issues));
  }
  const codes = found?.provider.entry.failure_codes;
  const failureCodes = codes === undefined ? {} : { failureCodes: codes };
  return Result.succeed(
    offered.flatMap(({ credential, destination }) => {
      const value = given[credential.name];
      return value === undefined ? [] : [{ name: credential.name, value, destination, ...failureCodes }];
    }),
  );
}

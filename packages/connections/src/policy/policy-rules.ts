import { isSignedInPerson } from '@on.auto/identity';
import { Forbidden, articled, listed, type CallerIdentity } from '@on.auto/operations';
import {
  loopbackHostOf,
  operatorMayNameHost,
  reservedHostKindOf,
  reservedReachOf,
  resolvedBySystem,
  type Noted,
  type Reaches,
  type Resolve,
} from '@on.auto/outbound';
import { wayAddresses } from '@on.auto/providers';
import { Effect } from 'effect';

import type { ConnectionEntry, ConnectionType } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';
import type { ConnectionPolicy } from './connection-policy.ts';

export type RuntimeAccess = 'people' | 'keys' | 'local';

export interface Addition {
  readonly provider: string | null;
  readonly type: ConnectionType;
  readonly entry: ConnectionEntry;
  readonly credential: Credential;
}

function allowing(items: readonly string[], none: string): string {
  return items.length === 0 ? none : listed(items);
}

function matches(pattern: string, host: string): boolean {
  const lowered = pattern.toLowerCase();
  return lowered.startsWith('*.') ? host.endsWith(lowered.slice(1)) : host === lowered;
}

function hostsOf({ type, entry, credential }: Addition, documentServer: string | undefined): readonly string[] {
  const server = type === 'mcp' ? [entry.url] : [entry.document, entry.base_url, documentServer];
  const addresses = [...server, ...wayAddresses.map((field) => credential[field])];
  return addresses.flatMap((address) => {
    const parsed = address === undefined ? null : URL.parse(address);
    return parsed === null ? [] : [parsed.hostname];
  });
}

export function hostRefusalOf(allowedHosts: readonly string[] | null, host: string): Forbidden | undefined {
  return allowedHosts === null || allowedHosts.some((pattern) => matches(pattern, host))
    ? undefined
    : new Forbidden({
        detail: `A connection may not reach the host ${host} on this runtime, which allows ${allowing(allowedHosts, 'no host')}`,
      });
}

const operatorNames = 'unless its operator names the host in connections.allowed_hosts';

function reservedRefusalOf(host: string, reached: string): Forbidden {
  const unless = operatorMayNameHost(host) ? `, ${operatorNames}` : '';
  return new Forbidden({ detail: `A connection may not reach the host ${host}, ${reached}${unless}` });
}

function namesLiterally(allowedHosts: readonly string[] | null, host: string): boolean {
  return (
    allowedHosts !== null &&
    operatorMayNameHost(host) &&
    allowedHosts.some((pattern) => !pattern.startsWith('*.') && matches(pattern, host))
  );
}

function allowsReserved(policy: ConnectionPolicy, host: string): boolean {
  return namesLiterally(policy.allowedHosts, host) || (policy.loopbackAllowed && loopbackHostOf(host));
}

async function reachRefusalOf(
  policy: ConnectionPolicy,
  host: string,
  resolve: Resolve,
  noted: Noted,
): Promise<string | undefined> {
  const unlisted = hostRefusalOf(policy.allowedHosts, host);
  if (unlisted !== undefined) {
    return unlisted.detail;
  }
  if (allowsReserved(policy, host)) {
    return undefined;
  }
  const reached = await reservedReachOf(host, resolve, noted);
  return reached === undefined ? undefined : reservedRefusalOf(host, reached).detail;
}

function loggedAsWarning(words: string): void {
  Effect.runSync(Effect.logWarning(words));
}

export function reachesUnder(
  policy: ConnectionPolicy,
  resolve: Resolve = resolvedBySystem,
  noted: Noted = loggedAsWarning,
): Reaches {
  return (url) => reachRefusalOf(policy, new URL(url).hostname, resolve, noted);
}

function hostRefusal(
  allowedHosts: readonly string[] | null,
  addition: Addition,
  documentServer: string | undefined,
): Forbidden | undefined {
  const refused = hostsOf(addition, documentServer).find((host) => hostRefusalOf(allowedHosts, host) !== undefined);
  return refused === undefined ? undefined : hostRefusalOf(allowedHosts, refused);
}

function reservedHostRefusal(
  policy: ConnectionPolicy,
  addition: Addition,
  documentServer: string | undefined,
): Forbidden | undefined {
  const refusals = hostsOf(addition, documentServer).flatMap((host) => {
    const kind = allowsReserved(policy, host) ? undefined : reservedHostKindOf(host);
    return kind === undefined ? [] : [reservedRefusalOf(host, kind)];
  });
  return refusals[0];
}

const variablesRule = 'A reference may name only a variable the operator lists in connections.variables';

function referenceRefusal(variables: readonly string[], { credential }: Addition): Forbidden | undefined {
  const { kind, variable = '' } = credential;
  if (kind !== 'reference' || variables.includes(variable)) {
    return undefined;
  }
  return new Forbidden({
    detail:
      variables.length === 0
        ? `${variablesRule}, and this runtime lists none`
        : `${variablesRule}, which are ${listed(variables)}, and ${variable} is not one of them`,
  });
}

function kindRefusal(credentialKinds: ConnectionPolicy['credentialKinds'], { credential }: Addition) {
  return credentialKinds === null || credentialKinds.includes(credential.kind)
    ? undefined
    : new Forbidden({
        detail: `A connection may not take ${articled(`${credential.kind} credential`)} on this runtime, which allows ${allowing(credentialKinds, 'no kind of credential')}`,
      });
}

export function adderRefusalOf(access: RuntimeAccess, caller: CallerIdentity): Forbidden | undefined {
  if (access === 'keys') {
    return new Forbidden({
      detail:
        'This runtime signs nobody in, so no person can approve a connection: set PUBLIC_URL, or add the server to the configuration',
    });
  }
  return access === 'people' && !isSignedInPerson(caller)
    ? new Forbidden({
        detail:
          'A connection is added by a person, through an agent signed in as them, and a key cannot add or reconnect one',
      })
    : undefined;
}

export function bindsPerson(access: RuntimeAccess): boolean {
  return access === 'people';
}

function rulesRefusalOf(
  policy: ConnectionPolicy,
  addition: Addition,
  documentServer: string | undefined,
): Forbidden | undefined {
  return (
    hostRefusal(policy.allowedHosts, addition, documentServer) ??
    reservedHostRefusal(policy, addition, documentServer) ??
    kindRefusal(policy.credentialKinds, addition) ??
    referenceRefusal(policy.variables, addition)
  );
}

export function addingRefusalOf({ peopleMayAdd }: ConnectionPolicy): Forbidden | undefined {
  return peopleMayAdd
    ? undefined
    : new Forbidden({
        detail: 'People may not add connections on this runtime: its operator sets up its tool servers itself',
      });
}

export function policyRefusalOf(
  policy: ConnectionPolicy,
  addition: Addition,
  documentServer: string | undefined,
): Forbidden | undefined {
  return addingRefusalOf(policy) ?? rulesRefusalOf(policy, addition, documentServer);
}

export function useRefusalOf(
  policy: ConnectionPolicy,
  addition: Addition,
  documentServer: string | undefined,
): Forbidden | undefined {
  return policy.peopleMayAdd
    ? rulesRefusalOf(policy, addition, documentServer)
    : new Forbidden({
        detail: 'This runtime uses no connection: its operator sets up its tool servers itself',
      });
}

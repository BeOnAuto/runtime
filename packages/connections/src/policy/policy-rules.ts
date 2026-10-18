import { isSignedInPerson } from '@on.auto/identity';
import { Forbidden, listed, type CallerIdentity } from '@on.auto/operations';

import type { ConnectionEntry, ConnectionType } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';
import type { ConnectionPolicy } from './connection-policy.ts';

export type RuntimeAccess = 'people' | 'keys' | 'local';

export interface Addition {
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
  const addresses = [...server, credential.issuer];
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

function hostRefusal(
  allowedHosts: readonly string[] | null,
  addition: Addition,
  documentServer: string | undefined,
): Forbidden | undefined {
  const refused = hostsOf(addition, documentServer).find((host) => hostRefusalOf(allowedHosts, host) !== undefined);
  return refused === undefined ? undefined : hostRefusalOf(allowedHosts, refused);
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
        detail: `A connection may not take a ${credential.kind} credential on this runtime, which allows ${allowing(credentialKinds, 'no kind of credential')}`,
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
        detail: 'A connection is added by a person, through an agent signed in as them, and a key cannot add one',
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

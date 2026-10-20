import { Effect } from 'effect';

import type { ConsentRefusal } from './consent-client.ts';

const scopeToken = '[\\x21\\x23-\\x5B\\x5D-\\x7E]+';

const scopeShape = new RegExp(`^${scopeToken}(?: ${scopeToken})*$`, 'u');

const separatorsOfAGrant = /[\s,]+/u;

const offlineAccess = 'offline_access';

export function isScope(text: string): boolean {
  return scopeShape.test(text);
}

function normalizedScopeOf(granted: string): string {
  return granted
    .split(separatorsOfAGrant)
    .filter((token) => token !== '')
    .join(' ');
}

export function withOfflineAccess(scope: string, scopesSupported: readonly string[] | undefined): string {
  return scopesSupported?.includes(offlineAccess) === true && !scope.split(' ').includes(offlineAccess)
    ? `${scope} ${offlineAccess}`
    : scope;
}

const noScope: ConsentRefusal = { refused: 'no_scope' };

const malformedScope: ConsentRefusal = { refused: 'malformed_scope' };

export function grantedScopeOf(
  granted: string | undefined,
  asked: string | undefined,
): Effect.Effect<string | undefined, ConsentRefusal> {
  if (granted === undefined) {
    return Effect.succeed(asked);
  }
  const scope = normalizedScopeOf(granted);
  if (scope === '') {
    return asked === undefined ? Effect.undefined : Effect.fail(noScope);
  }
  return isScope(scope) ? Effect.succeed(scope) : Effect.fail(malformedScope);
}

export function scopeRenewedOf(
  { scope }: { readonly scope?: string },
  previous: { readonly scope?: string },
): string | undefined {
  return scope === undefined ? previous.scope : normalizedScopeOf(scope);
}

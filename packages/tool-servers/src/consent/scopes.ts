const scopeToken = '[\\x21\\x23-\\x5B\\x5D-\\x7E]+';

const scopeShape = new RegExp(`^${scopeToken}(?: ${scopeToken})*$`, 'u');

const separatorsOfAGrant = /[\s,]+/u;

const offlineAccess = 'offline_access';

export function isScope(text: string): boolean {
  return scopeShape.test(text);
}

export function normalizedScopeOf(granted: string): string {
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

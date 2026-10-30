import { describe, expect, it } from 'vitest';

import { cognitiveServicesScope, type AccessToken } from './entra-id.ts';
import { installedPackages, loadEntraIdentity } from './installed-packages.ts';

function unresolved(specifier: string): never {
  throw Object.assign(new Error(`Cannot find package '${specifier}'`), { code: 'ERR_MODULE_NOT_FOUND' });
}

function tokenFor(token: string): Promise<AccessToken> {
  return Promise.resolve({ token, expiresOnTimestamp: Date.now() + 3_600_000 });
}

describe('loadEntraIdentity', () => {
  it('loads the installed identity library and builds its default credential without contacting anyone', async () => {
    const identity = await loadEntraIdentity();

    expect(typeof identity?.defaultCredential().getToken).toBe('function');
  });

  it('asks the credential for the Azure OpenAI scope', async () => {
    const asked: (string | readonly string[])[] = [];
    const identity = await loadEntraIdentity();
    const credential = {
      getToken: (scopes: string | readonly string[]) => {
        asked.push(scopes);
        return tokenFor('entra-token');
      },
    };

    await expect(identity?.bearerTokens(credential, cognitiveServicesScope)()).resolves.toBe('entra-token');
    expect(asked).toEqual([[cognitiveServicesScope]]);
  });
});

describe('installedPackages', () => {
  it('finds the identity library installed where it resolves', () => {
    expect(installedPackages()).toEqual({ entraId: true });
  });

  it('finds it missing when the package does not resolve', () => {
    expect(installedPackages(unresolved)).toEqual({ entraId: false });
  });

  it('passes any other failure on', () => {
    const broken = new TypeError('Invalid module specifier');

    expect(() =>
      installedPackages(() => {
        throw broken;
      }),
    ).toThrow(broken);
  });
});

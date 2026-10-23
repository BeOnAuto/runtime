import { describe, expect, it } from 'vitest';

import {
  cognitiveServicesScope,
  entraIdentityLoader,
  entraTokens,
  importUnlessMissing,
  installedPackages,
  loadEntraIdentity,
  type AccessToken,
} from './entra-id.ts';

function missingModule(): Promise<never> {
  return Promise.reject(
    Object.assign(new Error("Cannot find package '@azure/identity'"), { code: 'ERR_MODULE_NOT_FOUND' }),
  );
}

function unresolved(specifier: string): never {
  throw Object.assign(new Error(`Cannot find package '${specifier}'`), { code: 'ERR_MODULE_NOT_FOUND' });
}

function tokenFor(token: string): Promise<AccessToken> {
  return Promise.resolve({ token, expiresOnTimestamp: Date.now() + 3_600_000 });
}

describe('importUnlessMissing', () => {
  it('gives the module when it loads', async () => {
    await expect(importUnlessMissing(() => Promise.resolve({ loaded: true }))).resolves.toEqual({ loaded: true });
  });

  it('gives nothing when the package is not installed', async () => {
    await expect(importUnlessMissing(missingModule)).resolves.toBeUndefined();
  });

  it('passes any other failure on', async () => {
    const broken = new SyntaxError('Unexpected token');

    await expect(importUnlessMissing(() => Promise.reject(broken))).rejects.toBe(broken);
  });
});

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

  it('gives nothing when the library is not installed', async () => {
    await expect(entraIdentityLoader(missingModule)()).resolves.toBeUndefined();
  });
});

describe('entraTokens', () => {
  it('gives the bearer tokens of the default credential for the Azure OpenAI scope', async () => {
    const tokens = entraTokens({
      defaultCredential: () => ({ getToken: () => tokenFor('unused') }),
      bearerTokens: (_, scope) => () => Promise.resolve(`token for ${scope}`),
    });

    await expect(tokens()).resolves.toBe(`token for ${cognitiveServicesScope}`);
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

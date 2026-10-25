import { describe, expect, it } from 'vitest';

import {
  cognitiveServicesScope,
  entraIdentityLoader,
  entraTokens,
  importUnlessMissing,
  type AccessToken,
} from './entra-id.ts';

function missingModule(): Promise<never> {
  return Promise.reject(
    Object.assign(new Error("Cannot find package '@azure/identity'"), { code: 'ERR_MODULE_NOT_FOUND' }),
  );
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

describe('entraIdentityLoader', () => {
  it('gives nothing when the library is not installed', async () => {
    await expect(entraIdentityLoader(missingModule)()).resolves.toBeNull();
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

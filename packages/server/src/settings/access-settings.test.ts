import type { Environment } from '@on.auto/config';
import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

const httpOffLoopback =
  'InvalidSettingsError: PUBLIC_URL: Expected an https URL; an http URL is taken only for localhost, 127.0.0.1, or [::1]';

describe('readSettings signing persons in', () => {
  it('signs persons in through the Auto identity service once PUBLIC_URL is set, and on every interface through no one without it', () => {
    expect([
      readSettingsOf({ PUBLIC_URL: 'https://runtime.example.com' }).signIn,
      readSettingsOf({ IDENTITY_ISSUER: 'https://identity.example' }).signIn,
    ]).toEqual([{ issuer: 'https://clerk.on.auto', publicUrl: 'https://runtime.example.com' }, undefined]);
  });

  it('signs persons in through the identity service IDENTITY_ISSUER names, such as a development instance', () => {
    expect(
      readSettingsOf({ IDENTITY_ISSUER: 'https://identity.example', PUBLIC_URL: 'https://runtime.example.com' }).signIn,
    ).toEqual({ issuer: 'https://identity.example', publicUrl: 'https://runtime.example.com' });
  });

  it.each([
    ['127.0.0.1', 'http://localhost:5555'],
    ['127.0.0.1', 'http://127.0.0.1:5555'],
    ['127.0.0.1', 'http://[::1]:5555'],
    ['0.0.0.0', 'http://localhost:5555'],
  ])('takes on HOST=%s the http PUBLIC_URL=%s, whose host is a loopback name', (host, publicUrl) => {
    expect(readSettingsOf({ HOST: host, PUBLIC_URL: publicUrl }).signIn).toEqual({
      issuer: 'https://clerk.on.auto',
      publicUrl,
    });
  });

  it.each([
    ['127.0.0.1', 'http://runtime.example.com'],
    ['0.0.0.0', 'http://runtime.example.com'],
    ['0.0.0.0', 'http://192.168.1.20:5555'],
  ])('refuses on HOST=%s the http PUBLIC_URL=%s, naming the setting', (host, publicUrl) => {
    expect(String(errorFrom({ HOST: host, PUBLIC_URL: publicUrl }))).toBe(httpOffLoopback);
  });
});

describe('readSettings without PUBLIC_URL', () => {
  it.each([
    [{ HOST: '127.0.0.1' }],
    [{ HOST: 'localhost', PORT: '6000' }],
    [{ HOST: '::1' }],
    [{ HOST: '127.0.0.1', PORT: '0' }],
    [{ HOST: '0.0.0.0' }],
    [{ HOST: '127.0.0.1', IDENTITY_ISSUER: 'https://identity.example' }],
  ] as const)('signs no one in with %j, since PUBLIC_URL has no default', (server) => {
    expect(readSettingsOf(server).signIn).toBeUndefined();
  });

  it('signs persons in at PUBLIC_URL on a loopback address when PUBLIC_URL is set', () => {
    expect(readSettingsOf({ HOST: '127.0.0.1', PUBLIC_URL: 'https://runtime.example.com' }).signIn).toEqual({
      issuer: 'https://clerk.on.auto',
      publicUrl: 'https://runtime.example.com',
    });
  });
});

describe('readSettings rejects invalid credential settings', () => {
  it.each([
    'https://runtime.example.com/',
    'https://runtime.example.com/runtime',
    'https://runtime.example.com?tenant=acme',
    'https://runtime.example.com#top',
    'https://Runtime.example.com',
    'ftp://runtime.example.com',
    'runtime.example.com',
  ])('rejects PUBLIC_URL="%s", which is not an https URL without a path, naming the setting', (publicUrl) => {
    expect(String(errorFrom({ PUBLIC_URL: publicUrl }))).toBe(
      'InvalidSettingsError: SchemaError(Expected an https URL with no path, query or fragment, such as https://runtime.example.com\n  at ["PUBLIC_URL"])',
    );
  });

  it.each([
    'http://clerk.on.auto',
    'https://clerk.on.auto/tenant',
    'https://clerk.on.auto?x=1',
    'https://clerk.on.auto#y',
  ])(
    'rejects IDENTITY_ISSUER="%s", which is not the https URL of a service without a path, naming the setting',
    (issuer) => {
      expect(String(errorFrom({ IDENTITY_ISSUER: issuer }))).toBe(
        'InvalidSettingsError: SchemaError(Expected the https URL of the identity service, with no path, query or fragment, such as https://clerk.on.auto\n  at ["IDENTITY_ISSUER"])',
      );
    },
  );
});

const keySet = {
  keys: [{ kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo', kid: 'one', use: 'sig' }],
};

describe('readSettings given the key set of the identity service', () => {
  it('finds it through the metadata of the issuer when neither IDENTITY_JWKS nor IDENTITY_JWKS_URL is set', () => {
    expect(readSettingsOf({ PUBLIC_URL: 'https://runtime.example.com' }).identityKeySet).toEqual({ from: 'discovery' });
  });

  it('takes the key set IDENTITY_JWKS gives, as the JSON of a key set', () => {
    expect(readSettingsOf({ IDENTITY_JWKS: JSON.stringify(keySet) }).identityKeySet).toEqual({
      from: 'given',
      keySet,
    });
  });

  it('reads the key set at the https URL IDENTITY_JWKS_URL names', () => {
    expect(readSettingsOf({ IDENTITY_JWKS_URL: 'https://identity.example/keys/jwks.json' }).identityKeySet).toEqual({
      from: 'url',
      url: 'https://identity.example/keys/jwks.json',
    });
  });

  it('refuses both, naming the two settings', () => {
    expect(
      String(errorFrom({ IDENTITY_JWKS: JSON.stringify(keySet), IDENTITY_JWKS_URL: 'https://identity.example/jwks' })),
    ).toBe('InvalidSettingsError: IDENTITY_JWKS: Set one of IDENTITY_JWKS and IDENTITY_JWKS_URL, not more');
  });

  it.each([
    ['text that is not JSON', '{keys:[]}', 'Expected a valid JSON string\n  at ["IDENTITY_JWKS"]'],
    ['a set of no keys', '{"keys":[]}', 'Missing key\n  at ["IDENTITY_JWKS"]["keys"][0]'],
    ['a key without a kty', '{"keys":[{"kid":"one"}]}', 'Missing key\n  at ["IDENTITY_JWKS"]["keys"][0]["kty"]'],
  ])('refuses as IDENTITY_JWKS %s, naming the setting and where in it', (_case, value, words) => {
    expect(String(errorFrom({ IDENTITY_JWKS: value }))).toBe(`InvalidSettingsError: SchemaError(${words})`);
  });

  it('takes an empty IDENTITY_JWKS as not set', () => {
    expect(readSettingsOf({ IDENTITY_JWKS: '' }).identityKeySet).toEqual({ from: 'discovery' });
  });

  it.each(['http://identity.example/jwks', 'identity.example/jwks', 'ftp://identity.example/jwks'])(
    'refuses IDENTITY_JWKS_URL="%s", which is not an https URL, naming the setting',
    (url) => {
      expect(String(errorFrom({ IDENTITY_JWKS_URL: url }))).toBe(
        'InvalidSettingsError: SchemaError(Expected the https URL of the key set of the identity service, such as https://identity.example.com/.well-known/jwks.json\n  at ["IDENTITY_JWKS_URL"])',
      );
    },
  );
});

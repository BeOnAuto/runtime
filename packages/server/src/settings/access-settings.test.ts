import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';
import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

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

const company = {
  PUBLIC_URL: 'https://auto.example.com',
  OIDC_ISSUER: 'https://login.example.com/acme',
  OIDC_CLIENT_ID: 'auto-runtime',
  OIDC_CLIENT_SECRET: 'a-client-secret-of-the-test',
};

function settingNamedBy(environment: Environment): string | undefined {
  const words = String(errorFrom(environment));
  return /at \["([A-Z_]+)"\]/u.exec(words)?.[1] ?? /^InvalidSettingsError: ([A-Z_]+):/u.exec(words)?.[1];
}

function secretFileHolding(text: string, mode = 0o600): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-oidc-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true });
  });
  const file = join(folder, 'client-secret');
  writeFileSync(file, text, { mode });
  return file;
}

function clientSecretOf(environment: Environment): string | undefined {
  const { openIdConnect } = readSettingsOf(environment);
  return openIdConnect === undefined ? undefined : Redacted.value(openIdConnect.clientSecret);
}

describe("readSettings signing people in through the company's identity provider", () => {
  it('reads the provider, the client and the scopes, with the redirect URI under PUBLIC_URL', () => {
    const settings = readSettingsOf({ ...company, OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_post' });

    expect(settings.signIn).toEqual({ issuer: company.OIDC_ISSUER, publicUrl: company.PUBLIC_URL });
    expect(settings.openIdConnect).toMatchObject({
      issuer: company.OIDC_ISSUER,
      clientId: 'auto-runtime',
      scopes: ['openid', 'profile', 'email'],
      tokenEndpointAuthMethod: 'client_secret_post',
      publicUrl: company.PUBLIC_URL,
      redirectUri: 'https://auto.example.com/auth/oidc/callback',
    });
    expect(clientSecretOf(company)).toBe(company.OIDC_CLIENT_SECRET);
    expect(JSON.stringify(settings)).not.toContain(company.OIDC_CLIENT_SECRET);
  });

  it('reads the secret from OIDC_CLIENT_SECRET_FILE without its line ending, and the scopes OIDC_SCOPES lists', () => {
    const { OIDC_CLIENT_SECRET, ...withoutTheSecret } = company;
    const file = secretFileHolding(`${OIDC_CLIENT_SECRET}\n`);

    const environment = { ...withoutTheSecret, OIDC_CLIENT_SECRET_FILE: file, OIDC_SCOPES: 'openid  email' };

    expect(clientSecretOf(environment)).toBe(OIDC_CLIENT_SECRET);
    expect(readSettingsOf(environment).openIdConnect).toMatchObject({ scopes: ['openid', 'email'] });
  });

  it('leaves every setting as it is without OIDC_ISSUER, OIDC_CLIENT_ID and a secret', () => {
    expect(readSettingsOf({ PUBLIC_URL: company.PUBLIC_URL, OIDC_SCOPES: 'email' })).toMatchObject({
      signIn: { issuer: 'https://clerk.on.auto', publicUrl: company.PUBLIC_URL },
      openIdConnect: undefined,
    });
  });
});

describe("readSettings refusing the company's identity provider", () => {
  it.each<[string, Environment]>([
    ['OIDC_ISSUER', { OIDC_ISSUER: company.OIDC_ISSUER, PUBLIC_URL: company.PUBLIC_URL }],
    ['OIDC_ISSUER', { OIDC_CLIENT_ID: 'auto-runtime', OIDC_CLIENT_SECRET: 'secret', PUBLIC_URL: company.PUBLIC_URL }],
    [
      'OIDC_ISSUER',
      { OIDC_ISSUER: company.OIDC_ISSUER, OIDC_CLIENT_ID: 'auto-runtime', PUBLIC_URL: company.PUBLIC_URL },
    ],
    ['OIDC_CLIENT_SECRET', { ...company, OIDC_CLIENT_SECRET_FILE: '/run/secrets/oidc' }],
    ['OIDC_ISSUER', { ...company, IDENTITY_ISSUER: 'https://identity.example' }],
    ['OIDC_ISSUER', { ...company, IDENTITY_JWKS_URL: 'https://identity.example/jwks' }],
    ['ACCESS_MODE', { ...company, HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost:5555', ACCESS_MODE: 'local' }],
    ['OIDC_SCOPES', { ...company, OIDC_SCOPES: 'profile email' }],
    ['OIDC_ISSUER', { OIDC_ISSUER: company.OIDC_ISSUER, OIDC_CLIENT_ID: 'auto-runtime', OIDC_CLIENT_SECRET: 'secret' }],
    ['OIDC_ISSUER', { ...company, OIDC_ISSUER: 'http://login.example.com/acme' }],
    ['OIDC_ISSUER', { ...company, OIDC_ISSUER: 'https://login.example.com/acme?tenant=1' }],
    ['OIDC_ISSUER', { ...company, OIDC_ISSUER: 'https://login.example.com/acme#top' }],
    ['OIDC_ISSUER', { ...company, OIDC_CLIENT_ID: '' }],
    ['OIDC_TOKEN_ENDPOINT_AUTH_METHOD', { ...company, OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'private_key_jwt' }],
  ])('refuses to start, naming %s', (setting, environment) => {
    expect(settingNamedBy(environment)).toBe(setting);
  });

  it('refuses a secret file that does not exist, that the server cannot read, or that is empty', () => {
    const { OIDC_CLIENT_SECRET, ...withoutTheSecret } = company;
    const files = [
      join(tmpdir(), 'auto-runtime-no-such-secret'),
      secretFileHolding(OIDC_CLIENT_SECRET, 0o000),
      secretFileHolding('\n'),
    ];

    expect(files.map((file) => settingNamedBy({ ...withoutTheSecret, OIDC_CLIENT_SECRET_FILE: file }))).toEqual([
      'OIDC_CLIENT_SECRET_FILE',
      'OIDC_CLIENT_SECRET_FILE',
      'OIDC_CLIENT_SECRET_FILE',
    ]);
  });
});

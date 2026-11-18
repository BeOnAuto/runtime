import { Predicate, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeProvider, type Claims, type FakeProvider } from '../testing/fake-provider.ts';
import { metadataAddressOf } from './provider-metadata.ts';
import type { ProviderRequests } from './provider-requests.ts';
import { relyingPartyOf, UnusableIdentityProviderError, type RelyingPartySettings } from './relying-party.ts';

const issuer = 'https://login.example.com/tenant/v2.0';

function settingsOf(provider: FakeProvider, changes: Partial<RelyingPartySettings> = {}): RelyingPartySettings {
  return {
    issuer: provider.issuer,
    clientId: provider.clientId,
    clientSecret: Redacted.make(provider.clientSecret),
    scopes: ['openid'],
    tokenEndpointAuthMethod: undefined,
    redirectUri: 'https://auto.example.com/auth/oidc/callback',
    ...changes,
  };
}

function refusalOf(
  provider: FakeProvider,
  changes: Partial<RelyingPartySettings> = {},
  requests: ProviderRequests = provider.requests,
): Promise<unknown> {
  return relyingPartyOf(settingsOf(provider, changes), requests).then(
    () => 'used',
    (error: unknown) => error,
  );
}

function namedIn(refusal: unknown): readonly string[] {
  const message = Predicate.hasProperty(refusal, 'message') ? String(refusal.message) : '';
  return message
    .split(/[\s,]+/u)
    .map((word) => word.replace(/:$/u, ''))
    .filter((word) => word.includes('_') || word.includes('/') || /^\d+$/u.test(word));
}

function declaring(methods?: readonly string[]): FakeProvider {
  return fakeProvider(issuer, { metadata: { token_endpoint_auth_methods_supported: methods } });
}

function answering(body: string): ProviderRequests {
  return { fetch: () => Promise.resolve(new Response(body)) };
}

describe('the address of the metadata of the identity provider', () => {
  it('is the issuer, path and all, with a terminating slash taken off', () => {
    expect([
      metadataAddressOf(issuer),
      metadataAddressOf('https://login.example.com/'),
      metadataAddressOf(`${issuer}/`),
    ]).toEqual([
      `${issuer}/.well-known/openid-configuration`,
      'https://login.example.com/.well-known/openid-configuration',
      `${issuer}/.well-known/openid-configuration`,
    ]);
  });
});

describe('the metadata of the identity provider', () => {
  it('is used where it names its issuer identically, with https endpoints of the code flow', async () => {
    expect([await refusalOf(fakeProvider(issuer)), await refusalOf(fakeProvider(`${issuer}/`))]).toEqual([
      'used',
      'used',
    ]);
  });

  it('is refused where it names another issuer, even one that differs by a terminating slash', async () => {
    const refusal = await refusalOf(fakeProvider(issuer, { metadata: { issuer: `${issuer}/` } }));

    expect(refusal).toBeInstanceOf(UnusableIdentityProviderError);
    expect(namedIn(refusal)).toEqual([issuer, metadataAddressOf(issuer), `${issuer}/`]);
  });
});

describe('the endpoints in the metadata of the identity provider', () => {
  it.each<[string, Claims]>([
    ['authorization_endpoint', { authorization_endpoint: undefined }],
    ['token_endpoint', { token_endpoint: 'http://login.example.com/token' }],
    ['jwks_uri', { jwks_uri: 'http://127.0.0.1:5556/jwks' }],
    ['jwks_uri', { jwks_uri: 42 }],
  ])('is refused where it names no %s at an https URL', async (endpoint, metadata) => {
    expect(namedIn(await refusalOf(fakeProvider(issuer, { metadata })))).toContain(endpoint);
  });
});

describe('the metadata of the identity provider, as it is refused', () => {
  it('is refused where it declares no method a client secret proves itself by, or not the one asked for', async () => {
    const refusals = [
      await refusalOf(declaring(['private_key_jwt'])),
      await refusalOf(declaring(['client_secret_basic']), { tokenEndpointAuthMethod: 'client_secret_post' }),
      await refusalOf(declaring(), { tokenEndpointAuthMethod: 'client_secret_jwt' }),
    ];

    expect(refusals.map((refusal) => namedIn(refusal).slice(2))).toEqual([
      ['client_secret_basic', 'client_secret_post', 'client_secret_jwt', 'token_endpoint_auth_methods_supported'],
      ['client_secret_post', 'token_endpoint_auth_methods_supported'],
      ['client_secret_jwt', 'token_endpoint_auth_methods_supported'],
    ]);
  });

  it('is refused where it cannot be read, or is no JSON object with an issuer', async () => {
    const provider = fakeProvider(issuer);

    const refusals = [
      await refusalOf(provider, { issuer: `${issuer}/elsewhere` }),
      await refusalOf(provider, {}, answering('<html>')),
      await refusalOf(provider, {}, answering('["https://login.example.com"]')),
      await refusalOf(provider, {}, answering('{"issuer":7}')),
      await refusalOf(provider, {}, { fetch: () => Promise.reject(new TypeError('fetch failed')) }),
    ];

    expect(refusals.map((refusal) => namedIn(refusal).slice(1))).toEqual([
      [metadataAddressOf(`${issuer}/elsewhere`), '404'],
      [metadataAddressOf(issuer)],
      [metadataAddressOf(issuer)],
      [metadataAddressOf(issuer)],
      [metadataAddressOf(issuer)],
    ]);
  });
});

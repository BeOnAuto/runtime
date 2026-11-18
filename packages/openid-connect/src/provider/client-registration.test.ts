import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeProvider, type Claims, type FakeProvider, type FakeProviderOptions } from '../testing/fake-provider.ts';
import { UnusableIdentityProviderError } from './client-configuration.ts';
import { ClientRegistrationError, isLastingAt } from './client-registration.ts';
import { authorizationServerMetadataAddressOf, metadataAddressOf } from './provider-metadata.ts';
import type { ProviderRequests } from './provider-requests.ts';
import {
  registeringProviderOf,
  type RegisteringProvider,
  type RegisteringSettings,
} from './registered-relying-party.ts';

const issuer = 'https://login.example.com/tenant/v2.0';

const redirectUri = 'https://auto.example.com/auth/oidc/callback';

const withoutItsOwn: FakeProviderOptions = { metadata: { registration_endpoint: undefined } };

function settingsOf(provider: FakeProvider): RegisteringSettings {
  return {
    issuer: provider.issuer,
    scopes: ['openid', 'profile', 'email'],
    tokenEndpointAuthMethod: undefined,
    redirectUri,
    clientName: 'A runtime of the test',
  };
}

function registeringAt(provider: FakeProvider, requests = provider.requests): Promise<RegisteringProvider> {
  return registeringProviderOf(settingsOf(provider), requests);
}

function refusalOf(made: Promise<unknown>): Promise<unknown> {
  return made.then(
    () => 'used',
    (error: unknown) => (error instanceof ClientRegistrationError ? error.refusal : error),
  );
}

async function registrationRefusedBy(provider: FakeProvider, requests = provider.requests): Promise<unknown> {
  return refusalOf((await registeringAt(provider, requests)).registered());
}

function answeringAt(part: string, provider: FakeProvider, made: () => Promise<Response>): ProviderRequests {
  return { fetch: (request) => (request.url.includes(part) ? made() : provider.requests.fetch(request)) };
}

function answered(body: string, status = 200): () => Promise<Response> {
  return () => Promise.resolve(new Response(body, { status }));
}

describe('the address of the authorization server metadata of an identity provider', () => {
  it('puts the well-known path between the host and the path of the issuer, a terminating slash taken off', () => {
    expect(
      [issuer, `${issuer}/`, 'https://login.example.com/'].map((each) => authorizationServerMetadataAddressOf(each)),
    ).toEqual([
      'https://login.example.com/.well-known/oauth-authorization-server/tenant/v2.0',
      'https://login.example.com/.well-known/oauth-authorization-server/tenant/v2.0',
      'https://login.example.com/.well-known/oauth-authorization-server',
    ]);
  });
});

describe('the registration endpoint of an identity provider', () => {
  it('is the one its OpenID Connect metadata declares, or else the one its authorization server metadata of the same issuer declares', async () => {
    const declaring = fakeProvider(issuer);
    const elsewhere = fakeProvider(issuer, { ...withoutItsOwn, authorizationServerMetadata: {} });

    await (await registeringAt(declaring)).registered();
    await (await registeringAt(elsewhere)).registered();

    expect([declaring.registrationsAsked(), elsewhere.registrationsAsked()].map(({ length }) => length)).toEqual([
      1, 1,
    ]);
  });

  it('is none where neither declares one at an https URL, so the provider is one that does not offer registration', async () => {
    const plain = 'http://login.example.com/register';
    const providers = [
      fakeProvider(issuer, withoutItsOwn),
      fakeProvider(issuer, { ...withoutItsOwn, authorizationServerMetadata: { registration_endpoint: undefined } }),
      fakeProvider(issuer, {
        metadata: { registration_endpoint: plain },
        authorizationServerMetadata: { registration_endpoint: plain },
      }),
    ];

    const refusals = await Promise.all(providers.map((provider) => refusalOf(registeringAt(provider))));

    const notOffered = { notOffered: [metadataAddressOf(issuer), authorizationServerMetadataAddressOf(issuer)] };
    expect(refusals).toEqual([notOffered, notOffered, notOffered]);
  });
});

describe('an identity provider whose authorization server metadata cannot be used', () => {
  it('is refused where that metadata names another issuer, is no metadata or cannot be read, as where its own metadata cannot be used', async () => {
    const unread = fakeProvider(issuer, withoutItsOwn);
    const atTheMetadata = (body: string, status?: number) =>
      answeringAt('oauth-authorization-server', unread, answered(body, status));

    const refusals = [
      await refusalOf(
        registeringAt(
          fakeProvider(issuer, { ...withoutItsOwn, authorizationServerMetadata: { issuer: `${issuer}/` } }),
        ),
      ),
      await refusalOf(registeringAt(unread, atTheMetadata('{}', 500))),
      await refusalOf(registeringAt(unread, atTheMetadata('[1]'))),
      await refusalOf(registeringAt(fakeProvider(issuer, { metadata: { jwks_uri: undefined } }))),
    ];

    expect(refusals.map((refusal) => refusal instanceof UnusableIdentityProviderError)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('the request that registers a client', () => {
  it('asks for the redirect URI, the code flow, a web application, the scopes and the method the provider declares, and answers the client', async () => {
    const provider = fakeProvider(issuer, {
      metadata: { token_endpoint_auth_methods_supported: ['client_secret_post'] },
    });

    const client = await (await registeringAt(provider)).registered();

    expect(provider.registrationsAsked()).toEqual([
      {
        redirect_uris: [redirectUri],
        client_name: 'A runtime of the test',
        response_types: ['code'],
        grant_types: ['authorization_code'],
        application_type: 'web',
        token_endpoint_auth_method: 'client_secret_post',
        scope: 'openid profile email',
      },
    ]);
    expect([client.tokenEndpointAuthMethod, client.secretExpiresAt]).toEqual(['client_secret_post', 0]);
    expect(Redacted.value(client.clientSecret)).not.toBe('');
  });
});

async function clientRegisteredWith(registrationAnswer: Claims) {
  return (await registeringAt(fakeProvider(issuer, { registrationAnswer }))).registered();
}

describe('the client a registration answers', () => {
  it('proves itself by the method the provider registered, client_secret_basic where it answers none, and keeps the end of its secret', async () => {
    const clients = [
      await clientRegisteredWith({ token_endpoint_auth_method: 'client_secret_jwt' }),
      await clientRegisteredWith({ token_endpoint_auth_method: undefined, client_secret_expires_at: 4_102_444_800 }),
      await clientRegisteredWith({ client_secret_expires_at: undefined }),
    ];

    expect(clients.map((client) => [client.tokenEndpointAuthMethod, client.secretExpiresAt])).toEqual([
      ['client_secret_jwt', 0],
      ['client_secret_basic', 4_102_444_800],
      ['client_secret_basic', 0],
    ]);
  });

  it('is taken with wider scopes than asked or no scope answered, and refused without a scope it asked for, naming each', async () => {
    const refusals = [
      await refusalOf(clientRegisteredWith({ scope: 'openid profile email offline_access' })),
      await refusalOf(clientRegisteredWith({ scope: undefined })),
      await refusalOf(clientRegisteredWith({ scope: 'openid email' })),
    ];

    expect(refusals).toEqual(['used', 'used', { withoutScopes: ['profile'] }]);
  });
});

const anyText: unknown = expect.any(String);

describe('a registration answer that cannot be used', () => {
  it.each<[string, Claims]>([
    ['no client_id', { client_id: '' }],
    ['no client_secret', { client_secret: undefined }],
    ['no redirect URI of its own', { redirect_uris: ['https://elsewhere.example.com/auth/oidc/callback'] }],
    ['no redirect URIs', { redirect_uris: undefined }],
    ['a method no client secret proves itself by', { token_endpoint_auth_method: 'private_key_jwt' }],
    ['a secret that has ended', { client_secret_expires_at: 1_000_000_000 }],
    ['a secret whose end is no time', { client_secret_expires_at: 'never' }],
  ])('is refused as unusable, with %s', async (_case, registrationAnswer) => {
    expect(await refusalOf(clientRegisteredWith(registrationAnswer))).toEqual({ unusable: anyText });
  });
});

describe('a registration the identity provider refuses', () => {
  it('is refused with the error code it answers, or its status, and unreached where its endpoint cannot be reached', async () => {
    const provider = fakeProvider(issuer);
    const atTheEndpoint = (made: () => Promise<Response>) => answeringAt('/register', provider, made);

    const refusals = [
      await registrationRefusedBy(fakeProvider(issuer, { registrationError: 'invalid_client_metadata' })),
      await registrationRefusedBy(provider, atTheEndpoint(answered('<html>Forbidden</html>', 403))),
      await registrationRefusedBy(provider, atTheEndpoint(answered('{"error":"not \\"a code\\""}', 400))),
      await registrationRefusedBy(provider, atTheEndpoint(answered('["a client"]', 201))),
      await registrationRefusedBy(
        provider,
        atTheEndpoint(() => Promise.reject(new TypeError('fetch failed'))),
      ),
    ];

    expect(refusals).toEqual([
      { refused: 'invalid_client_metadata' },
      { refused: 'it answered 403' },
      { refused: 'it answered 400' },
      { unusable: 'it answered no JSON object' },
      { unreached: 'cannot be reached' },
    ]);
  });

  it('is told in an error that names the issuer and the redirect URI', async () => {
    const provider = fakeProvider(issuer, { registrationError: 'invalid_redirect_uri' });

    const refused = await (await registeringAt(provider)).registered().catch((error: unknown) => error);

    expect(refused).toMatchObject({ _tag: 'ClientRegistrationError', issuer, redirectUri });
  });
});

describe('the end of the secret of a registered client', () => {
  it('never comes where the provider answers 0, and comes at the second it answers', () => {
    const at = Date.parse('2026-11-18T09:00:00Z');
    const seconds = at / 1000;

    expect([0, seconds + 1, seconds].map((secretExpiresAt) => isLastingAt({ secretExpiresAt }, at))).toEqual([
      true,
      true,
      false,
    ]);
  });
});

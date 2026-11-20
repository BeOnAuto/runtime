import { UnusableIdentityProviderError, type ProviderRequests, type RegisteredClient } from '@on.auto/openid-connect';
import { fakeProvider, type FakeProvider, type FakeProviderOptions } from '@on.auto/openid-connect/testing';
import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ClientsReport } from '../logging/sign-in-logging.ts';
import type { OpenIdConnectSettings } from '../settings/openid-connect-settings.ts';
import type { SignInClientRegistrations } from './client-registrations.ts';
import { asItsClient, issuerOf, signInByDefaultOf } from './company-client.ts';

const issuer = 'https://identity.example/default';

const settings: OpenIdConnectSettings = {
  issuer,
  client: undefined,
  scopes: ['openid', 'groups'],
  tokenEndpointAuthMethod: undefined,
  publicUrl: 'https://auto.example.com:8443',
  redirectUri: 'https://auto.example.com:8443/auth/oidc/callback',
  requiredClaim: { claim: 'tenant' },
};

const nothingReported: ClientsReport = {
  registered: Function.constVoid,
  registeredElsewhereFirst: Function.constVoid,
  notRegistered: Function.constVoid,
};

function keptHere(): SignInClientRegistrations {
  const kept: RegisteredClient[] = [];
  return {
    latestAt: () => Promise.resolve(kept.at(-1)?.clientId),
    named: (_place, clientId) => Promise.resolve(kept.find((client) => client.clientId === clientId)),
    kept: (_place, client) => {
      kept.push(client);
      return Promise.resolve({ inUse: client, recordedFirstElsewhere: false });
    },
  };
}

interface Reached extends ProviderRequests {
  readonly provider: FakeProvider;
  readonly asked: () => readonly string[];
  readonly unreachable: (yes: boolean) => void;
}

function reached(options: FakeProviderOptions = {}): Reached {
  const provider = fakeProvider(issuer, options);
  const asked: string[] = [];
  const state = { unreachable: false };
  return {
    provider,
    asked: () => [...asked],
    unreachable: (yes) => {
      state.unreachable = yes;
    },
    fetch: (request: Readonly<Request>) => {
      asked.push(new URL(request.url).pathname);
      return state.unreachable ? Promise.reject(new TypeError('fetch failed')) : provider.requests.fetch(request);
    },
  };
}

async function signingInByDefault(at: Reached, registrations = keptHere()) {
  const signIn = signInByDefaultOf(settings, at);
  const { relyingParty } = await asItsClient(signIn, { registrations: () => registrations, report: nothingReported });
  return { signIn, relyingParty, registrations };
}

function failureOf(made: Promise<unknown>): Promise<unknown> {
  return made.then(
    () => 'begun',
    (failure: unknown) => failure,
  );
}

describe('a sign-in through the default identity provider, as it begins', () => {
  it('reads nothing of the provider until a sign-in begins, then registers once, by the name and the address of this server', async () => {
    const at = reached();
    const { signIn, relyingParty } = await signingInByDefault(at);
    const beforeAnySignIn = at.asked();

    const first = await relyingParty.signInStarted();
    await relyingParty.signInStarted();

    const introduced: unknown = expect.objectContaining({
      client_name: 'Auto Runtime at auto.example.com:8443',
      client_uri: 'https://auto.example.com:8443',
      redirect_uris: [settings.redirectUri],
      scope: 'openid groups',
    });
    expect([beforeAnySignIn, issuerOf(signIn), relyingParty.issuer]).toEqual([[], issuer, issuer]);
    expect(new URL(first.authorizationUrl).pathname).toBe('/default/authorize');
    expect(at.provider.registrationsAsked()).toEqual([introduced]);
    expect(at.asked().filter((path) => path.endsWith('/openid-configuration'))).toHaveLength(1);
  });

  it('cannot begin while the provider cannot be read or will not register this server, and tries again at the next sign-in', async () => {
    const unread = reached();
    const refusing = reached({ registrationError: 'invalid_client_metadata' });
    unread.unreachable(true);
    const signingIn = await signingInByDefault(unread);

    const failures = [
      await failureOf(signingIn.relyingParty.signInStarted()),
      await failureOf((await signingInByDefault(refusing)).relyingParty.signInStarted()),
    ];
    unread.unreachable(false);

    expect(failures.map((failure) => failure instanceof UnusableIdentityProviderError)).toEqual([true, true]);
    expect(await failureOf(signingIn.relyingParty.signInStarted())).toBe('begun');
  });
});

describe('a sign-in through the default identity provider, as it ends', () => {
  it('finishes a sign-in begun before a restart, and answers one it could not finish since the provider cannot be read as failed', async () => {
    const at = reached();
    const begun = await signingInByDefault(at);
    const started = await begun.relyingParty.signInStarted();
    const restarted = await signingInByDefault(at, begun.registrations);
    const query = at.provider.signedIn(started.authorizationUrl, 'a-person');

    const finished = await restarted.relyingParty.signInFinished(query, started.pending);
    at.unreachable(true);
    const unread = await (
      await signingInByDefault(at, begun.registrations)
    ).relyingParty.signInFinished(query, started.pending);

    const namingTheProvider: unknown = expect.stringContaining(issuer);
    expect(finished).toMatchObject({ signedIn: { issuer, subject: 'a-person' } });
    expect(unread).toEqual({ failed: namingTheProvider });
  });

  it('passes on a failure of its own store, at the start and the end of a sign-in alike', async () => {
    const store = new Error('the store cannot answer');
    const failing = { ...keptHere(), latestAt: () => Promise.reject(store) };
    const { relyingParty } = await signingInByDefault(reached(), failing);

    expect([
      await failureOf(relyingParty.signInStarted()),
      await failureOf(relyingParty.signInFinished('', { state: 's', nonce: 'n', codeVerifier: 'v' })),
    ]).toEqual([store, store]);
  });
});

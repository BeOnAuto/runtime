import { describe, expect, it } from 'vitest';

import { fakeProvider, type FakeProvider, type FakeProviderOptions } from '../testing/fake-provider.ts';
import type { RegisteredClient, RelyingPartyClient } from './client-registration.ts';
import {
  registeringProviderOf,
  type RegisteringProvider,
  type RelyingPartyClients,
} from './registered-relying-party.ts';
import type { RelyingParty } from './relying-party.ts';

const issuer = 'https://login.example.com/tenant/v2.0';

const subject = 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4';

interface ClientsKept extends RelyingPartyClients {
  readonly refusedOnes: () => readonly string[];
  readonly kept: (client: RegisteredClient) => void;
}

function clientsKept(): ClientsKept {
  const kept: RelyingPartyClient[] = [];
  const refusedOnes: string[] = [];
  return {
    refusedOnes: () => [...refusedOnes],
    kept: (client) => {
      kept.push(client);
    },
    inUse: () => {
      const [latest] = kept.toReversed();
      return latest === undefined ? Promise.reject(new Error('No client is kept')) : Promise.resolve(latest);
    },
    named: (clientId) => Promise.resolve(kept.find((client) => client.clientId === clientId)),
    refused: ({ clientId }) => {
      refusedOnes.push(clientId);
      return Promise.resolve();
    },
  };
}

interface SigningIn {
  readonly provider: FakeProvider;
  readonly registering: RegisteringProvider;
  readonly clients: ClientsKept;
  readonly first: RegisteredClient;
  readonly party: RelyingParty;
}

async function signingInAs(options: FakeProviderOptions = {}): Promise<SigningIn> {
  const provider = fakeProvider(issuer, options);
  const registering = await registeringProviderOf(
    {
      issuer,
      scopes: ['openid'],
      tokenEndpointAuthMethod: undefined,
      redirectUri: 'https://auto.example.com/auth/oidc/callback',
      clientName: 'A runtime of the test',
    },
    provider.requests,
  );
  const clients = clientsKept();
  const first = await registering.registered();
  clients.kept(first);
  return { provider, registering, clients, first, party: registering.relyingPartyOf(clients) };
}

async function finishedBy({ provider, party }: SigningIn) {
  const started = await party.signInStarted();
  return party.signInFinished(provider.signedIn(started.authorizationUrl, subject), started.pending);
}

describe('a sign-in as a client the server registered', () => {
  it('begins as the client in use, which its pending sign-in notes, and finishes as the client it notes', async () => {
    const { provider, clients, first, party, registering } = await signingInAs();
    const started = await party.signInStarted();
    const second = await registering.registered();
    clients.kept(second);

    const finished = await party.signInFinished(provider.signedIn(started.authorizationUrl, subject), started.pending);
    const again = await party.signInStarted();
    const lastly = await party.signInStarted();

    expect(new URL(started.authorizationUrl).searchParams.get('client_id')).toBe(first.clientId);
    expect([started, again, lastly].map(({ pending }) => pending.clientId)).toEqual([
      first.clientId,
      second.clientId,
      second.clientId,
    ]);
    expect(finished).toEqual({ signedIn: { issuer, subject }, claims: {} });
  });

  it('does not finish where its pending sign-in notes no client or one the server does not keep, and is refused as another client', async () => {
    const { provider, party, clients, registering } = await signingInAs();
    const started = await party.signInStarted();
    const { clientId: _noted, ...unnoted } = started.pending;
    const other = await registering.registered();
    clients.kept(other);
    const answered = provider.signedIn(started.authorizationUrl, subject);

    const finished = [
      await party.signInFinished(answered, unnoted),
      await party.signInFinished(answered, { ...started.pending, clientId: 'unknown' }),
      await party.signInFinished(answered, { ...started.pending, clientId: other.clientId }),
    ];

    const anyText: unknown = expect.any(String);
    const notFinished = { failed: anyText };
    expect(finished).toEqual([notFinished, notFinished, { refusedByTheProvider: 'invalid_grant' }]);
    expect(clients.refusedOnes()).toEqual([]);
  });
});

describe('a sign-in as a client the identity provider refuses', () => {
  it('tells the clients which one was refused, by an error in the answer or by a challenge, and only then', async () => {
    const answered = await signingInAs({ metadata: { token_endpoint_auth_methods_supported: ['client_secret_jwt'] } });
    const challenged = await signingInAs({ challengesTheClient: true });
    const refusing = await signingInAs({ tokenError: 'invalid_grant' });
    answered.provider.withdraw(answered.first.clientId);
    challenged.provider.withdraw(challenged.first.clientId);

    const finished = [await finishedBy(answered), await finishedBy(challenged), await finishedBy(refusing)];

    expect(finished).toEqual([
      { refusedByTheProvider: 'invalid_client' },
      { failed: 'OAUTH_WWW_AUTHENTICATE_CHALLENGE' },
      { refusedByTheProvider: 'invalid_grant' },
    ]);
    expect([answered, challenged, refusing].map(({ clients }) => clients.refusedOnes())).toEqual([
      [answered.first.clientId],
      [challenged.first.clientId],
      [],
    ]);
  });
});

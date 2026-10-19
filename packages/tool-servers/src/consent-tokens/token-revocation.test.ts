import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import type { ConsentClient, RevokeAsked } from '../consent/consent-client.ts';
import {
  connectedByConsent,
  consentClientAt,
  everyHost,
  registeredAt,
  returnAddress,
  servedForConsent,
  type ClientRegistration,
  type ConsentConnected,
  type FakeMcpServer,
} from '../testing/index.ts';
import { keptTokensOf } from './kept-tokens.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function connectedAt(changes: Partial<ClientRegistration> = {}): Promise<ConsentConnected> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  return connectedByConsent(fake);
}

function revokeAskedOf({ fake, client, tokens }: ConsentConnected): RevokeAsked {
  return {
    server: { type: 'mcp', url: fake.url },
    way: { issuer: fake.origin, scope: 'files.read' },
    returnAddress,
    reaches: everyHost,
    client,
    tokens,
  };
}

function revoked(consent: ConsentClient, connected: ConsentConnected) {
  return Effect.runPromise(Effect.result(consent.revoke(revokeAskedOf(connected))));
}

function heardAt(fake: FakeMcpServer, path: string): number {
  return fake.heard().filter((heard) => heard.path === path).length;
}

function failingRevocations(failure: Readonly<Error>) {
  return (...[address, init]: readonly [unknown, unknown?]): Promise<Response> =>
    String(address).endsWith('/revoke')
      ? Promise.reject(failure)
      : globalThis.fetch(String(address), Object.assign({}, init));
}

describe('the revocation a removal asks for', () => {
  it('revokes the refresh token, and with it the access token, with the client of the connection', async () => {
    const connected = await connectedAt();

    const answered = await revoked(consentClientAt(connected.fake), connected);

    expect(answered).toMatchObject({ _tag: 'Success' });
    expect(await admitted(connected.fake, keptTokensOf(connected.tokens).access_token)).toBe(false);
  });

  it('revokes the access token where the server gave no refresh token', async () => {
    const connected = await connectedAt({ issuesRefreshTokens: false });

    await revoked(consentClientAt(connected.fake), connected);

    expect(await admitted(connected.fake, keptTokensOf(connected.tokens).access_token)).toBe(false);
  });
});

describe('a revocation that does not happen', () => {
  it('is refused in the status the server answered, or in the words of a request that failed, scrubbed', async () => {
    const connected = await connectedAt();
    const { refresh_token: refreshToken = '' } = keptTokensOf(connected.tokens);
    const wrongSecret = consentClientAt(connected.fake, {
      registeredClients: [
        registeredAt(connected.fake.origin, {
          credential: { kind: 'client_secret', clientSecret: Redacted.make('another-secret-of-the-client') },
        }),
      ],
    });
    const failing = consentClientAt(connected.fake, {
      fetch: failingRevocations(new Error(`The connection reset while it sent ${refreshToken}`)),
    });

    const refused = await revoked(wrongSecret, connected);
    const failed = await revoked(failing, connected);

    expect([refused, failed]).toMatchObject([
      { failure: { refused: 'not_revoked', detail: 'it answered HTTP 401' } },
      { failure: { refused: 'not_revoked', detail: 'The connection reset while it sent [redacted]' } },
    ]);
    expect(await admitted(connected.fake, keptTokensOf(connected.tokens).access_token)).toBe(true);
  });

  it('is refused as gone where the client of the connection is no longer registered, and sends nothing', async () => {
    const connected = await connectedAt();
    const renamed = consentClientAt(connected.fake, {
      registeredClients: [registeredAt(connected.fake.origin, { clientId: 'renamed' })],
    });

    expect(await revoked(renamed, connected)).toMatchObject({ failure: { refused: 'client_gone' } });
    expect(heardAt(connected.fake, '/revoke')).toBe(0);
  });
});

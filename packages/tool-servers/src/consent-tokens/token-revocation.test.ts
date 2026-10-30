import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import type { ConsentClient, RevokeAsked } from '../consent/consent-client.ts';
import {
  connectedByConsent,
  consentClientAt,
  everyHost,
  hostRefusedAt,
  registeredAfterAnother,
  registeredAt,
  returnAddress,
  type ClientRegistration,
  type ConsentConnected,
} from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function connectedAt(changes: Partial<ClientRegistration> = {}): Promise<ConsentConnected> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  return connectedByConsent(fake);
}

function revokeAskedOf({ fake, client, kept: tokens }: ConsentConnected): RevokeAsked {
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
    expect(await admitted(connected.fake, connected.kept.access_token)).toBe(false);
  });

  it('revokes with the client of the connection where another registered client stands first at the issuer', async () => {
    const connected = await connectedAt();
    const consent = consentClientAt(connected.fake, {
      registeredClients: registeredAfterAnother(connected.fake.origin),
    });

    expect(await revoked(consent, connected)).toMatchObject({ _tag: 'Success' });
    expect(await admitted(connected.fake, connected.kept.access_token)).toBe(false);
  });

  it('revokes the access token where the server gave no refresh token', async () => {
    const connected = await connectedAt({ issuesRefreshTokens: false });

    await revoked(consentClientAt(connected.fake), connected);

    expect(await admitted(connected.fake, connected.kept.access_token)).toBe(false);
  });
});

describe('a revocation that does not happen', () => {
  it('is refused in the status the server answered, as unanswered where the request failed, and in the rule of a host refused', async () => {
    const connected = await connectedAt();
    const rule = 'The rules of whoever runs Auto do not allow the host 127.0.0.1';
    const wrongSecret = consentClientAt(connected.fake, {
      registeredClients: [
        registeredAt(connected.fake.origin, {
          credential: { kind: 'client_secret', clientSecret: Redacted.make('another-secret-of-the-client') },
        }),
      ],
    });
    const failing = consentClientAt(connected.fake, { fetch: failingRevocations(new Error('The connection reset')) });
    const refusing = consentClientAt(connected.fake, { fetch: hostRefusedAt('/revoke', rule) });

    const refused = await revoked(wrongSecret, connected);
    const failed = await revoked(failing, connected);
    const refusedItsHost = await revoked(refusing, connected);

    expect([refused, failed, refusedItsHost]).toMatchObject([
      { failure: { refused: 'not_revoked', status: 401 } },
      { failure: { refused: 'unanswered' } },
      { failure: { refused: 'host', rule } },
    ]);
    expect(await admitted(connected.fake, connected.kept.access_token)).toBe(true);
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

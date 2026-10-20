import { Effect, Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import type { KeptTokens } from '../consent-tokens/kept-tokens.ts';
import type { ConsentClient, RevokeAsked } from '../consent/consent-client.ts';
import {
  connectedThroughAuto,
  consentClientThrough,
  consentClientWith,
  everyHost,
  returnAddress,
  servedThroughAuto,
  type ConsentConnected,
  type ThroughAuto,
} from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Connected extends ThroughAuto {
  readonly connection: ConsentConnected;
  readonly first: KeptTokens;
}

async function connectedAt(): Promise<Connected> {
  const serving = await servedThroughAuto();
  closing.push(serving.close);
  const connection = await connectedThroughAuto(serving);
  return { ...serving, connection, first: connection.kept };
}

function revokeAskedOf({ fake, connection }: Connected, tokens: KeptTokens = connection.kept): RevokeAsked {
  return {
    server: { type: 'mcp', url: fake.url },
    way: { issuer: fake.origin, scope: 'files.read' },
    returnAddress,
    reaches: everyHost,
    client: connection.client,
    tokens,
  };
}

function revokedBy(consent: ConsentClient, asked: RevokeAsked) {
  return Effect.runPromise(Effect.flip(consent.revoke(asked)));
}

function heardAt({ service }: Pick<ThroughAuto, 'service'>, path: string) {
  return service.calls().filter((call) => call.path === path);
}

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

describe('the revocation through Auto’s consent service a removal asks for', () => {
  it('revokes the tokens with the connection key, and with them the grant at the authorization server', async () => {
    const connected = await connectedAt();

    const revoked = await Effect.runPromise(
      Effect.result(consentClientThrough(connected).revoke(revokeAskedOf(connected))),
    );

    expect(revoked).toMatchObject({ _tag: 'Success' });
    expect(await admitted(connected.fake, connected.first.access_token)).toBe(false);
    expect(heardAt(connected, '/tokens/revoke').map(({ body }) => body)).toEqual([
      {
        issuer: connected.fake.origin,
        access_token: connected.first.access_token,
        refresh_token: connected.first.refresh_token,
        connection_key: connected.first.connection_key,
      },
    ]);
  });
});

describe('a revocation through Auto’s consent service that does not happen', () => {
  it('is refused as not revoked in the status the authorization server answered, unanswered where the service is gone, and as gone where the source of Auto is off', async () => {
    const connected = await connectedAt();
    const gone = await connectedAt();
    connected.service.refuseNext('revoke');
    await gone.service.close();

    expect([
      await revokedBy(consentClientThrough(connected), revokeAskedOf(connected)),
      await revokedBy(consentClientThrough(gone), revokeAskedOf(gone)),
      await revokedBy(consentClientWith(), revokeAskedOf(connected)),
    ]).toEqual([{ refused: 'not_revoked', status: 503 }, { refused: 'unanswered' }, { refused: 'client_gone' }]);
    expect(await admitted(connected.fake, connected.first.access_token)).toBe(true);
  });

  it('is refused as a key the service does not know where it no longer keeps it, and where the row holds none, which asks nothing', async () => {
    const connected = await connectedAt();
    const client = consentClientThrough(connected);
    await Effect.runPromise(client.revoke(revokeAskedOf(connected)));
    const { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType } = connected.first;
    const unkeyed = { access_token: accessToken, refresh_token: required(refreshToken), token_type: tokenType };

    expect([
      await revokedBy(client, revokeAskedOf(connected)),
      await revokedBy(client, revokeAskedOf(connected, unkeyed)),
    ]).toEqual([{ refused: 'unknown_key' }, { refused: 'unknown_key' }]);
    expect(heardAt(connected, '/tokens/revoke')).toHaveLength(2);
  });
});

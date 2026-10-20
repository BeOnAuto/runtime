import { Effect, Option, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted, postedTo } from '../authorization-testing/authorization-requests.ts';
import { secretsOf } from '../bounds/secrets.ts';
import { keptValueOf, type KeptTokens } from '../consent-tokens/kept-tokens.ts';
import { renewalWords } from '../consent-tokens/renewal-words.ts';
import type { ConsentClient, RevokeAsked } from '../consent/consent-client.ts';
import {
  brokenWords,
  connectedThroughAuto,
  consentClientThrough,
  consentClientWith,
  everyHost,
  memoryTokens,
  returnAddress,
  rowOf,
  servedOf,
  servedThroughAuto,
  servedTokensOf,
  type ClientRegistration,
  type ConsentConnected,
  type MemoryTokens,
  type ThroughAuto,
} from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const renewalTime = 3_540_000;

interface Connected extends ThroughAuto {
  readonly connection: ConsentConnected;
  readonly first: KeptTokens;
  readonly row: MemoryTokens;
}

async function connectedAt(changes: Partial<ClientRegistration> = {}): Promise<Connected> {
  const serving = await servedThroughAuto(changes);
  closing.push(serving.close);
  const connection = await connectedThroughAuto(serving);
  return { ...serving, connection, first: connection.kept, row: rowOf(connection, serving.clock.now) };
}

function sourceOf(connected: Connected, consent: ConsentClient = consentClientThrough(connected)) {
  return servedTokensOf(servedOf(connected.connection, connected.row), connected.clock.now, consent).source;
}

function renewed({ clock }: Connected, source: ReturnType<typeof sourceOf>): Promise<unknown> {
  clock.setTo(renewalTime);
  return source.token().catch((error: unknown) => error);
}

function heardAt({ service }: Connected, path: string) {
  return service.calls().filter((call) => call.path === path);
}

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

function unauthorizedAt({ fake }: Pick<Connected, 'fake'>) {
  return { response: new Response(null, { status: 401 }), serverUrl: new URL(fake.url), fetchFn: globalThis.fetch };
}

function revokedBy(consent: ConsentClient, asked: Connected) {
  return Effect.runPromise(Effect.flip(consent.revoke(revokeAskedOf(asked))));
}

function revokeAskedOf({ fake, connection }: Connected): RevokeAsked {
  return {
    server: { type: 'mcp', url: fake.url },
    way: { issuer: fake.origin, scope: 'files.read' },
    returnAddress,
    reaches: everyHost,
    client: connection.client,
    tokens: connection.kept,
  };
}

describe('the renewal of the tokens of a consent through Auto’s consent service', () => {
  it('asks the service to refresh with the refresh token, the connection key and the resource, under the lease of its claim, and keeps the key with the new tokens', async () => {
    const connected = await connectedAt();
    const { first } = connected;

    const token = await renewed(connected, sourceOf(connected));

    expect(token).not.toBe(first.access_token);
    expect(await admitted(connected.fake, token)).toBe(true);
    expect(connected.row.claims()).toEqual([45_000]);
    expect(connected.row.kept()).toEqual({
      access_token: token,
      refresh_token: first.refresh_token,
      expires_at: '1970-01-01T01:59:00.000Z',
      scope: 'files.read',
      token_type: 'Bearer',
      connection_key: first.connection_key,
    });
    expect(heardAt(connected, '/tokens/refresh').map(({ body }) => body)).toEqual([
      {
        issuer: connected.fake.origin,
        refresh_token: first.refresh_token,
        connection_key: first.connection_key,
        resource: `${connected.fake.origin}/mcp`,
      },
    ]);
  });

  it('holds the connection key among the secrets it scrubs from the moment it reads the row', async () => {
    const connected = await connectedAt();
    const secrets = secretsOf([]);
    servedTokensOf(
      servedOf(connected.connection, connected.row),
      connected.clock.now,
      consentClientThrough(connected),
      secrets,
    );

    expect(secrets.scrub(String(connected.first.connection_key))).toBe('[redacted]');
  });
});

describe('a renewal through Auto’s consent service that is refused', () => {
  it('breaks the connection in the words of an ended consent where the service refuses the refresh token its row still holds', async () => {
    const revoked = await connectedAt();
    const refusing = await connectedAt();
    await postedTo(revoked.fake, '/revoke', { token: required(revoked.first.refresh_token) });
    refusing.service.refuseNext('refresh');

    expect([await renewed(revoked, sourceOf(revoked)), await renewed(refusing, sourceOf(refusing))]).toEqual([
      new Error(brokenWords('consent_ended')),
      new Error(brokenWords('consent_ended')),
    ]);
    expect([revoked.row.ends(), refusing.row.ends()]).toEqual([['consent_ended'], ['consent_ended']]);
  });

  it('breaks the connection where its row holds no connection key, and asks the service nothing', async () => {
    const connected = await connectedAt();
    const { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType } = connected.first;
    const unkeyed = keptValueOf({
      access_token: accessToken,
      refresh_token: required(refreshToken),
      token_type: tokenType,
    });
    const row = memoryTokens(unkeyed, { now: connected.clock.now });

    const failed = await sourceOf({ ...connected, row })
      .onUnauthorized(unauthorizedAt(connected))
      .catch((error: unknown) => error);

    expect(failed).toEqual(new Error(brokenWords('consent_ended')));
    expect(heardAt(connected, '/tokens/refresh')).toEqual([]);
  });
});

describe('a renewal through Auto’s consent service that cannot ask it', () => {
  it('breaks the connection as a client gone where the source of Auto is off, and asks the service nothing', async () => {
    const connected = await connectedAt();

    const failed = await renewed(connected, sourceOf(connected, consentClientWith({ renewalSpreadMs: 0 })));

    expect(failed).toEqual(new Error(brokenWords('client_gone')));
    expect(heardAt(connected, '/tokens/refresh')).toEqual([]);
  });

  it('fails the call within the bound of its request where the service stalls, and breaks nothing', async () => {
    const connected = await connectedAt();
    connected.service.stall();

    const failed = await renewed(connected, sourceOf(connected, consentClientThrough(connected, { requestMs: 50 })));

    expect(failed).toEqual(new Error(renewalWords.unanswered('files')));
    expect([connected.row.ends(), connected.row.version(), connected.row.claims()]).toEqual([[], 1, [15_050]]);
  });
});

describe('tokens renewed through Auto’s consent service that the store refuses to keep', () => {
  it('are revoked through the service, and the call fails in the words of the store', async () => {
    const connected = await connectedAt();
    const { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType } = connected.first;
    const lean = keptValueOf({
      access_token: accessToken,
      refresh_token: required(refreshToken),
      token_type: tokenType,
      connection_key: required(connected.first.connection_key),
    });
    const mostCharacters = Redacted.value(lean).length;
    const row = rowOf({ ...connected.connection, tokens: lean }, connected.clock.now, mostCharacters);

    const failed = await sourceOf({ ...connected, row })
      .onUnauthorized(unauthorizedAt(connected))
      .catch((error: unknown) => error);

    expect(failed).toEqual(new Error(`A secret to keep holds more than ${mostCharacters} characters`));
    expect(heardAt(connected, '/tokens/revoke')).toHaveLength(1);
  });
});

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

  it('is refused as not revoked where the service could not, unanswered where it is gone, and as gone where the source of Auto is off', async () => {
    const connected = await connectedAt();
    const gone = await connectedAt();
    connected.service.refuseNext('revoke');
    await gone.service.close();

    expect([
      await revokedBy(consentClientThrough(connected), connected),
      await revokedBy(consentClientThrough(gone), gone),
      await revokedBy(consentClientWith(), connected),
    ]).toEqual([{ refused: 'not_revoked', status: 502 }, { refused: 'unanswered' }, { refused: 'client_gone' }]);
    expect(await admitted(connected.fake, connected.first.access_token)).toBe(true);
  });
});

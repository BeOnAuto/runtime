import { Option, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted, postedTo } from '../authorization-testing/authorization-requests.ts';
import { secretsOf } from '../bounds/secrets.ts';
import { keptValueOf, type KeptTokens } from '../consent-tokens/kept-tokens.ts';
import { renewalWords } from '../consent-tokens/renewal-words.ts';
import type { ConsentClient } from '../consent/consent-client.ts';
import {
  autoClientsOf,
  brokenWords,
  connectedThroughAuto,
  consentClientThrough,
  consentClientWith,
  memoryTokens,
  rowOf,
  servedOf,
  servedThroughAuto,
  servedTokensOf,
  type ClientRegistration,
  type ConsentConnected,
  type MemoryTokens,
  type ThroughAuto,
} from '../testing/index.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';

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

function rowHolding(connected: Connected, tokens: KeptTokens): MemoryTokens {
  return memoryTokens(keptValueOf(tokens), { now: connected.clock.now });
}

async function forbiddingEverything(): Promise<string> {
  const forbidding = await serveOnLoopback(() => () => Promise.resolve(new Response('Forbidden', { status: 403 })));
  closing.push(forbidding.close);
  return forbidding.origin;
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
});

describe('a renewal through Auto’s consent service without a key it knows', () => {
  it('breaks the connection in the words of a key the service does not know, where it refuses the key the row holds', async () => {
    const connected = await connectedAt();
    const row = rowHolding(connected, { ...connected.first, connection_key: 'a-key-the-service-never-gave' });

    const failed = await sourceOf({ ...connected, row })
      .onUnauthorized(unauthorizedAt(connected))
      .catch((error: unknown) => error);

    expect(failed).toEqual(new Error(brokenWords('key_unknown')));
    expect(heardAt(connected, '/tokens/refresh')).toHaveLength(1);
  });

  it('breaks the connection so too where its row holds no key, and asks the service nothing', async () => {
    const connected = await connectedAt();
    const { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType } = connected.first;
    const row = rowHolding(connected, {
      access_token: accessToken,
      refresh_token: required(refreshToken),
      token_type: tokenType,
    });

    const failed = await sourceOf({ ...connected, row })
      .onUnauthorized(unauthorizedAt(connected))
      .catch((error: unknown) => error);

    expect(failed).toEqual(new Error(brokenWords('key_unknown')));
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

  it('fails the call within the bound of its request where the service stalls, in its own words, and breaks nothing', async () => {
    const connected = await connectedAt();
    connected.service.stall();

    const failed = await renewed(connected, sourceOf(connected, consentClientThrough(connected, { requestMs: 50 })));

    expect(failed).toEqual(new Error(renewalWords.serviceUnanswered('files')));
    expect([connected.row.ends(), connected.row.version(), connected.row.claims()]).toEqual([[], 1, [15_050]]);
  });

  it('fails the call and breaks nothing where something answers 403 without a refusal of the service', async () => {
    const connected = await connectedAt();
    const forbidding = consentClientWith({
      autoClients: autoClientsOf({ url: await forbiddingEverything() }),
      renewalSpreadMs: 0,
    });

    const failed = await renewed(connected, sourceOf(connected, forbidding));

    expect(failed).toEqual(new Error(renewalWords.serviceUnanswered('files')));
    expect([connected.row.ends(), connected.row.version()]).toEqual([[], 1]);
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

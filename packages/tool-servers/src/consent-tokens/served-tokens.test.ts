import { generateKeyPairSync } from 'node:crypto';

import { Option, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import { secretsOf } from '../bounds/secrets.ts';
import {
  connectedByConsent,
  consentClientAt,
  registeredAfterAnother,
  registeredAt,
  rowOf,
  servedOf,
  servedTokensOf,
  type ClientRegistration,
  type MemoryTokens,
  clockAt,
} from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';
import type { KeptTokens } from './kept-tokens.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await servedForConsent(changes);
  closing.push(fake.close);
  return fake;
}

const anHourLess = { minute: 3_540_000, spread: 3_535_000 };

function keptIn(row: MemoryTokens): KeptTokens {
  return Option.getOrThrow(Option.fromNullishOr(row.kept()));
}

function unauthorizedAt(fake: FakeMcpServer) {
  return { response: new Response(null, { status: 401 }), serverUrl: new URL(fake.url), fetchFn: globalThis.fetch };
}

async function servingAt(changes: Partial<ClientRegistration> = {}, renewalSpreadMs = 0) {
  const fake = await served(changes);
  const connected = await connectedByConsent(fake);
  const clock = clockAt(0);
  const row = rowOf(connected, clock.now);
  const secrets = secretsOf([]);
  const { source } = servedTokensOf(
    servedOf(connected, row),
    clock.now,
    consentClientAt(fake, { renewalSpreadMs }),
    secrets,
  );
  return { fake, clock, row, source, secrets, first: keptIn(row) };
}

describe('the tokens of a connection connected by consent', () => {
  it('are read at first use and served until a minute before they end, then renewed and their row replaced', async () => {
    const { fake, clock, row, source, first } = await servingAt();

    const atFirstUse = await source.token();
    clock.setTo(anHourLess.minute - 1);
    const beforeRenewal = await source.token();
    clock.setTo(anHourLess.minute);
    const renewed = await source.token();

    expect([atFirstUse, beforeRenewal]).toEqual([first.access_token, first.access_token]);
    expect(renewed).not.toBe(first.access_token);
    expect(fake.tokenRequests()).toBe(2);
    expect(row.version()).toBe(2);
    expect(row.kept()).toEqual({
      access_token: renewed,
      refresh_token: first.refresh_token,
      expires_at: '1970-01-01T01:59:00.000Z',
      scope: 'files.read',
      token_type: 'Bearer',
    });
    expect(await admitted(fake, renewed)).toBe(true);
  });

  it('are renewed halfway through a life shorter than two minutes', async () => {
    const { fake, clock, source, first } = await servingAt({ expiresInSeconds: 60 });

    clock.setTo(29_999);
    const beforeRenewal = await source.token();
    clock.setTo(30_000);
    const renewed = await source.token();

    expect(beforeRenewal).toBe(first.access_token);
    expect(renewed).not.toBe(first.access_token);
    expect(fake.tokenRequests()).toBe(2);
  });

  it('are renewed into a bearer token where the token answer names no token_type', async () => {
    const { fake, clock, row, source, first } = await servingAt({ namesTokenType: false });

    clock.setTo(anHourLess.minute);
    const renewed = await source.token();

    expect(renewed).not.toBe(first.access_token);
    expect(row.kept()).toMatchObject({ access_token: renewed, token_type: 'Bearer' });
    expect(await admitted(fake, renewed)).toBe(true);
  });
});

describe('the spread of the renewal time of a process', () => {
  it('renews the tokens of a consent earlier by its few seconds, and never by more than half the lead', async () => {
    const spread = await servingAt({}, 5000);
    const short = await servingAt({ expiresInSeconds: 60 }, 50_000);

    spread.clock.setTo(anHourLess.spread - 1);
    const beforeRenewal = await spread.source.token();
    spread.clock.setTo(anHourLess.spread);
    const renewed = await spread.source.token();
    short.clock.setTo(14_999);
    const beforeHalfTheLead = await short.source.token();
    short.clock.setTo(15_000);
    const renewedAtHalfTheLead = await short.source.token();

    expect(beforeRenewal).toBe(spread.first.access_token);
    expect(renewed).not.toBe(spread.first.access_token);
    expect(beforeHalfTheLead).toBe(short.first.access_token);
    expect(renewedAtHalfTheLead).not.toBe(short.first.access_token);
  });
});

describe('the renewal of the tokens of a connection connected by consent', () => {
  it('is made once for every concurrent caller past the renewal time', async () => {
    const { fake, clock, source } = await servingAt();

    clock.setTo(anHourLess.minute);
    const tokens = await Promise.all([source.token(), source.token(), source.token()]);

    expect(new Set(tokens).size).toBe(1);
    expect(fake.tokenRequests()).toBe(2);
  });

  it('is made when the server refuses the access token, before the renewal time', async () => {
    const { fake, source, first } = await servingAt();

    await source.onUnauthorized(unauthorizedAt(fake));
    const renewed = await source.token();

    expect(renewed).not.toBe(first.access_token);
    expect(await admitted(fake, renewed)).toBe(true);
  });

  it('keeps the refresh token the server rotates the tokens with', async () => {
    const { clock, row, source, first } = await servingAt({ rotatesRefreshTokens: true });

    clock.setTo(anHourLess.minute);
    await source.token();

    expect(keptIn(row).refresh_token).toMatch(/^refresh-/u);
    expect(keptIn(row).refresh_token).not.toBe(first.refresh_token);
  });
});

describe('the renewal of a connection at an issuer where another registered client stands first', () => {
  it('is made with the client the connection was made with', async () => {
    const fake = await served();
    const connected = await connectedByConsent(fake);
    const clock = clockAt(0);
    const row = rowOf(connected, clock.now);
    const consent = consentClientAt(fake, { registeredClients: registeredAfterAnother(fake.origin) });
    const { source } = servedTokensOf(servedOf(connected, row), clock.now, consent);

    clock.setTo(anHourLess.minute);
    const renewed = await source.token();

    expect(await admitted(fake, renewed)).toBe(true);
    expect([fake.tokenRequests(), row.version()]).toEqual([2, 2]);
  });
});

describe('the renewal of the tokens of a consent with a key', () => {
  it('signs the assertion of a client with a key, and keeps no scope where the consent was given none', async () => {
    const keys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const fake = await served({ clientSecret: undefined, publicKey: keys.publicKey });
    const keyed = {
      registeredClients: [
        registeredAt(fake.origin, {
          credential: { kind: 'private_key', privateKey: Redacted.make(keys.privateKey), algorithm: 'RS256' },
        }),
      ],
    };
    const connected = await connectedByConsent(fake, { scope: undefined }, keyed);
    const clock = clockAt(0);
    const row = rowOf(connected, clock.now);
    const { source } = servedTokensOf(
      servedOf(connected, row, { scope: undefined }),
      clock.now,
      consentClientAt(fake, keyed),
    );

    clock.setTo(anHourLess.minute);
    const renewed = await source.token();

    expect(await admitted(fake, renewed)).toBe(true);
    expect(Object.keys(keptIn(row))).toEqual(['access_token', 'refresh_token', 'expires_at', 'token_type']);
  });
});

describe('the tokens of a server that gives no expiry', () => {
  it('are served until the server refuses them, then renewed', async () => {
    const { fake, clock, row, source, first } = await servingAt({ expiresInSeconds: null });

    clock.setTo(10 * 365 * 24 * 3_600_000);
    const longAfter = await source.token();
    await source.onUnauthorized(unauthorizedAt(fake));
    const renewed = await source.token();

    expect(longAfter).toBe(first.access_token);
    expect(renewed).not.toBe(first.access_token);
    expect(Object.keys(keptIn(row))).toEqual(['access_token', 'refresh_token', 'scope', 'token_type']);
    expect(fake.tokenRequests()).toBe(2);
  });
});

describe('the tokens of a consent among the secrets', () => {
  it('are scrubbed from the moment they are read, each with its predecessor after a renewal', async () => {
    const { clock, row, source, secrets, first } = await servingAt({ rotatesRefreshTokens: true });
    const firstPair = `${first.access_token} ${String(first.refresh_token)}`;

    const asRead = secrets.scrub(firstPair);
    clock.setTo(anHourLess.minute);
    await source.token();
    const second = keptIn(row);
    const secondPair = `${second.access_token} ${String(second.refresh_token)}`;
    const afterRenewal = secrets.scrub(`${firstPair} ${secondPair}`);
    clock.setTo(2 * anHourLess.minute + 60_000);
    await source.token();
    const afterTheNext = secrets.scrub(`${firstPair} ${secondPair}`);

    expect(asRead).toBe('[redacted] [redacted]');
    expect(afterRenewal).toBe('[redacted] [redacted] [redacted] [redacted]');
    expect(afterTheNext).toBe(`${firstPair} [redacted] [redacted]`);
  });
});

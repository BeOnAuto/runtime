import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { readProviders, providersShippedRoots } from '@on.auto/providers';
import { admitted, clockAt, manualTimer } from '@on.auto/tool-servers/testing';
import { Function, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { appSecret, studioReturn, theOrgsApp } from '../testing/consents.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';
import { consentServedAs, sourceOver } from '../testing/served-connections.ts';
import { xApi, xMetadata } from '../testing/shipped-vendors.ts';
import { consentedAtTheVendor, harnessAtTheVendor, servedAsTheVendor } from '../testing/vendor-fakes.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const connectedAt = Date.parse('2026-10-15T14:00:00.000Z');

const twoHoursMs = 7_200_000;

const askedOfX = 'tweet.read tweet.write users.read offline.access';

const ListedProvidersSchema = Schema.Struct({
  output: Schema.Struct({
    providers: Schema.Array(
      Schema.Struct({ name: Schema.String, credentials: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
    ),
  }),
});

const ConnectedSchema = Schema.Struct({
  output: Schema.Struct({
    id: Schema.String,
    status: Schema.String,
    granted_scope: Schema.NullOr(Schema.String),
    credential: Schema.Struct({ client_id: Schema.String, client_source: Schema.String }),
  }),
});

async function servedAsX() {
  const fake = await servedAsTheVendor(xApi);
  closing.push(fake.close);
  const asked: string[] = [];
  const h = harnessAtTheVendor(fake, xApi, {
    providers: shipped,
    registeredIssuer: undefined,
    asking: (address) => {
      asked.push(address);
    },
  });
  return { fake, h, asked };
}

async function connectedAtX() {
  const { fake, h, asked: addressesAsked } = await servedAsX();
  const { asked, finished } = await consentedAtTheVendor(
    h,
    { provider: 'x', placeholders: {}, orgsApp: theOrgsApp },
    { fake, vendor: xApi },
  );
  const connected = Schema.decodeUnknownSync(ConnectedSchema)(finished).output;
  return { fake, h, asked, addressesAsked, connected, source: sourceOver(h, { providers: shipped }) };
}

async function waysOfXListedBy(h: Harness) {
  const listed = Schema.decodeUnknownSync(ListedProvidersSchema)(
    await h.call(operationNamed(h.operations, 'list_providers'), ada),
  );
  return listed.output.providers.find(({ name }) => name === 'x')?.credentials;
}

describe('the provider x, whose consent runs under the org’s own app alone', () => {
  it('is listed under the org’s own app, offered where no client here covers it, and added by its name alone under that app', async () => {
    const { h } = await servedAsX();

    const ways = await waysOfXListedBy(h);
    const added = await h.call(operationNamed(h.operations, 'add_connection'), ada, { provider: 'x' });

    expect(ways).toEqual([expect.objectContaining({ kind: 'authorization', own_app: 'required', offered: true })]);
    expect(ways?.[0]).not.toHaveProperty('because');
    expect(added).toMatchObject({
      status: 'succeeded',
      output: {
        name: 'x',
        status: 'pending',
        credential: { kind: 'authorization', issuer: 'https://api.x.com', scope: askedOfX, client_source: 'own' },
      },
    });
  });
});

describe('the consent of x', () => {
  it('starts at X’s authorization endpoint with the org’s client, an S256 challenge and the four scopes, and finishes by the secret in the Basic header, which X takes alone, never reading the metadata X publishes', async () => {
    const { fake, h, asked, addressesAsked, connected } = await connectedAtX();
    const facts = await h.facts();

    expect(`${asked.origin}${asked.pathname}`).toBe('https://x.com/i/oauth2/authorize');
    expect(
      ['client_id', 'redirect_uri', 'scope', 'code_challenge_method'].map((name) => asked.searchParams.get(name)),
    ).toEqual([theOrgsApp.client_id, studioReturn, askedOfX, 'S256']);
    expect(asked.searchParams.get('code_challenge')).toEqual(expect.stringMatching(/^[\w-]{43}$/u));
    expect(connected).toMatchObject({
      status: 'connected',
      granted_scope: askedOfX,
      credential: { client_id: theOrgsApp.client_id, client_source: 'own' },
    });
    expect(fake.tokenRequests()).toBe(1);
    expect(addressesAsked).toContain('https://api.x.com/2/oauth2/token');
    expect(addressesAsked).not.toContain(xMetadata);
    expect(JSON.stringify(facts)).not.toContain(appSecret);
  });
});

describe('the tokens of a connection to x', () => {
  it('renew the access token of two hours with the refresh token X rotates at each renewal, keeping the new one each time', async () => {
    const { fake, h, connected, source } = await connectedAtX();
    const consent = await consentServedAs(source, connected.id);
    const clock = clockAt(connectedAt + twoHoursMs);
    const tokens = h.consent.tokenSource(consent, {
      name: 'x',
      holder: 'connection x',
      now: clock.now,
      timer: manualTimer().timer,
      hold: Function.constVoid,
    });

    const first = await tokens.token();
    clock.advance(twoHoursMs);
    const second = await tokens.token();

    expect(consent.held.tokens).toMatchObject({ expires_at: new Date(connectedAt + twoHoursMs).toISOString() });
    expect(consent.held.tokens).toHaveProperty('refresh_token');
    expect(new Set([consent.held.tokens.access_token, first, second]).size).toBe(3);
    expect(await admitted(fake, second)).toBe(true);
    expect(fake.tokenRequests()).toBe(3);
  });

  it('are revoked at X’s revocation endpoint with the org’s client as the connection is removed', async () => {
    const { fake, h, connected, source } = await connectedAtX();
    const consent = await consentServedAs(source, connected.id);

    const removed = await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: connected.id });

    expect(removed).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(await admitted(fake, consent.held.tokens.access_token)).toBe(false);
  });
});

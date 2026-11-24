import { keyMadeAt, providerListOf, providerOf } from '@on.auto/providers/testing';
import { fakeMcpInProcess, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { added, billing, issuesIn, reconnected } from '../testing/additions.ts';
import { documentsOffTheLoopback } from '../testing/harness-services.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

function giving(h: Harness, input: Readonly<Record<string, string>>) {
  return h.call(operationNamed(h.operations, 'give_credential'), ada, input);
}

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const theAppsSecret = 'billing-client-secret';

const namingTheCode: unknown = expect.stringContaining('invalid_client');

function issuerTaking(clientSecret: string): FakeMcpServer {
  const fake = fakeMcpInProcess({ client: { clientId: 'acme', clientSecret, expiresInSeconds: 3600 } });
  closing.push(fake.close);
  return fake;
}

function billingAt({ origin }: FakeMcpServer) {
  return { ...billing, credential: { ...billing.credential, issuer: origin } };
}

function connectionOf(h: Harness, id: string) {
  return h.call(operationNamed(h.operations, 'get_connection'), ada, { id });
}

type Fetch = typeof globalThis.fetch;

function besideTheIssuer(atTheIssuer: (request: Readonly<Request>) => Promise<Response>): Fetch {
  return (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    return new URL(request.url).hostname === new URL(billing.credential.issuer).hostname
      ? atTheIssuer(request)
      : documentsOffTheLoopback(request.url, Object.assign({}, init));
  };
}

const refusedWithItsWords = besideTheIssuer(({ url }) =>
  Promise.resolve(
    url.endsWith('/token')
      ? Response.json(
          { error: 'invalid_client', error_description: 'Invalid client secret provided.\r\nTrace ID: 0f3c' },
          { status: 401 },
        )
      : new Response(null, { status: 404 }),
  ),
);

const unreached = besideTheIssuer(() => Promise.reject(new TypeError('fetch failed')));

describe('client credentials given for a connection', () => {
  it('are used to ask its issuer for a token before anything is kept, and connect it where the issuer answers', async () => {
    const fake = issuerTaking(theAppsSecret);
    const askedWhenKept: number[] = [];
    const h = harness({ beforeKeeping: () => Promise.resolve(askedWhenKept.push(fake.tokenRequests())) });
    const { id, token } = await added(h, billingAt(fake));

    expect(await giving(h, { id, token, client_secret: theAppsSecret })).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'connected' },
    });
    expect(askedWhenKept).toEqual([1]);
  });

  it('are refused with the code the issuer answers where it refuses them, nothing kept or recorded, the link left open', async () => {
    const fake = issuerTaking(theAppsSecret);
    const h = harness();
    const { id, token } = await added(h, billingAt(fake));
    const recorded = (await h.facts()).length;

    expect(await giving(h, { id, token, client_secret: 'the-id-of-the-secret' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '', detail: namingTheCode }],
    });
    expect([h.secrets.values().size, (await h.facts()).length]).toEqual([0, recorded]);
    expect(await giving(h, { id, token, client_secret: theAppsSecret })).toMatchObject({ status: 'succeeded' });
  });

  it('are refused with the description the issuer gives beside its code, on one line', async () => {
    const h = harness({ fetch: refusedWithItsWords });
    const { id, token } = await added(h, billing);

    const [issue] = issuesIn(await giving(h, { id, token, client_secret: theAppsSecret }));

    expect(issue?.pointer).toBe('');
    expect(
      ['invalid_client', 'Invalid client secret provided. Trace ID: 0f3c'].map((part) => issue?.detail.includes(part)),
    ).toEqual([true, true]);
    expect(h.secrets.values().size).toBe(0);
  });
});

describe('client credentials given where the issuer cannot be reached, or on reconnecting a connection', () => {
  it('answer unavailable, keeping nothing, where the issuer cannot be reached', async () => {
    const h = harness({ fetch: unreached });
    const { id, token } = await added(h, billing);

    expect(await giving(h, { id, token, client_secret: theAppsSecret })).toMatchObject({ reason: 'unavailable' });
    expect(h.secrets.values().size).toBe(0);
  });

  it('leave a connected connection as it was where the issuer refuses the ones given on reconnecting it', async () => {
    const fake = issuerTaking(theAppsSecret);
    const h = harness();
    const { id, token } = await added(h, billingAt(fake));
    await giving(h, { id, token, client_secret: theAppsSecret });
    const link = await reconnected(h, id);
    const recorded = (await h.facts()).length;

    expect(await giving(h, { id, token: link.token, client_secret: 'the-id-of-the-secret' })).toMatchObject({
      reason: 'invalid_input',
    });
    expect([[...h.secrets.values().values()], (await h.facts()).length]).toEqual([[theAppsSecret], recorded]);
    expect(await connectionOf(h, id)).toMatchObject({ output: { status: 'connected' } });
  });
});

function ledgerAt({ origin }: FakeMcpServer) {
  return providerListOf(
    providerOf({
      name: 'ledger',
      title: 'Ledger',
      description: 'Read the invoices of a ledger.',
      website: 'https://developer.ledger.example.com',
      type: 'mcp',
      url: 'https://mcp.ledger.example.com/mcp',
      credentials: [
        {
          kind: 'secret',
          in: 'header',
          name: 'Authorization',
          scheme: 'Bearer',
          ...keyMadeAt('app.ledger.example.com'),
        },
        {
          kind: 'client_credentials',
          issuer: origin,
          description: 'The client ID and secret of an app your company registers at the ledger.',
        },
      ],
    }),
  );
}

describe('client credentials given for the way chosen on reconnecting a connection', () => {
  it('leave it on the way it connects by where the issuer refuses them, and switch it once it answers', async () => {
    const fake = issuerTaking(theAppsSecret);
    const h = harness({ providers: ledgerAt(fake) });
    const { id, token } = await added(h, { provider: 'ledger', credential: { kind: 'secret' } });
    await giving(h, { id, token, value: 'ledger-key-0f3c' });
    const link = await reconnected(h, id);
    await h.call(operationNamed(h.operations, 'choose_way'), ada, {
      id,
      token: link.token,
      credential: { kind: 'client_credentials' },
    });
    const theApp = { id, token: link.token, client_id: 'acme' };

    expect(await giving(h, { ...theApp, client_secret: 'the-id-of-the-secret' })).toMatchObject({
      reason: 'invalid_input',
    });
    expect(await connectionOf(h, id)).toMatchObject({
      output: { status: 'connected', credential: { kind: 'secret' } },
    });
    expect(await giving(h, { ...theApp, client_secret: theAppsSecret })).toMatchObject({
      status: 'succeeded',
      output: { credential: { kind: 'client_credentials' } },
    });
  });
});

const theBooksDocument = 'https://books.example.com/openapi.json';

function booksDescribedAt(document: string) {
  return providerListOf(
    providerOf({
      name: 'books',
      title: 'Books',
      description: 'Read the books of a company.',
      website: 'https://developer.books.example.com',
      type: 'openapi',
      document,
      credentials: [
        {
          kind: 'client_credentials',
          issuer: 'https://auth.books.example.com',
          description: 'The client ID and secret of an app your company registers at Books.',
        },
      ],
    }),
  );
}

const notADocument: Fetch = (...[address, init]: readonly [unknown, unknown?]) =>
  String(address) === theBooksDocument
    ? Promise.resolve(Response.json({}))
    : documentsOffTheLoopback(String(address), Object.assign({}, init));

async function booksGivenTheApp(h: Harness) {
  const { id, token } = await added(h, { provider: 'books' });
  return giving(h, { id, token, client_id: 'acme', client_secret: theAppsSecret });
}

describe('client credentials given for a connection whose API is addressed by its document alone', () => {
  it('answer unavailable where the document cannot be read now, and are refused where the runtime cannot read it, keeping nothing', async () => {
    const providers = booksDescribedAt(theBooksDocument);
    const unread = harness({ providers });
    const unreadable = harness({ providers, fetch: notADocument });

    const given = await Promise.all([unread, unreadable].map((h) => booksGivenTheApp(h)));

    expect(given).toMatchObject([{ reason: 'unavailable' }, { reason: 'invalid_input' }]);
    expect([unread.secrets.values().size, unreadable.secrets.values().size]).toEqual([0, 0]);
  });
});

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, adding, issuesIn } from '../testing/additions.ts';
import { ada, harness, operationNamed } from '../testing/harness.ts';
import {
  askedThrough,
  givenAs,
  ledgers,
  ledgersBase,
  ledgersDocument,
  ledgersKeyHelp,
  listingEntries,
  recordedAfter,
  refusedAt,
  textOf,
  withPaths,
} from '../testing/ledgers-documents.ts';

function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('an HTTP API given its OpenAPI document in document_text', () => {
  it('is added with its record naming the document by its SHA-256, size and number of tools, its entry naming base_url alone, asking no address anything', async () => {
    const asking = askedThrough();
    const h = harness({ fetch: asking.fetch });
    const text = textOf(ledgersDocument);

    await added(h, ledgers);

    const [fact] = await h.facts();
    expect(fact?.data).toMatchObject({
      server_type: 'openapi',
      entry: { base_url: ledgersBase },
      document: { sha256: sha256Of(text), bytes: Buffer.byteLength(text), tool_count: 2 },
    });
    expect(fact?.data).not.toHaveProperty('entry.document');
    expect(asking.asked()).toEqual([]);
  });

  it('answers, lists and reads the connection with the SHA-256, the size and the number of tools of its document, never its text', async () => {
    const h = harness();
    const text = textOf(ledgersDocument);
    const shown = { sha256: sha256Of(text), bytes: Buffer.byteLength(text), tool_count: 2 };

    const answered = await adding(h, ledgers);
    const { id } = await added(h, { ...ledgers, name: 'ledgers-eu' });
    const listed = await h.call(operationNamed(h.operations, 'list_connections'), ada);
    const read = await h.call(operationNamed(h.operations, 'get_connection'), ada, { id });

    expect(answered).toMatchObject({
      status: 'succeeded',
      output: { entry: { base_url: ledgersBase }, document: shown },
    });
    expect(listed).toMatchObject({ output: { connections: [{ document: shown }, { document: shown }] } });
    expect(read).toMatchObject({ output: { id, document: shown } });
    expect(JSON.stringify([answered, listed, read])).not.toContain('between two days');
  });
});

describe('the document given in document_text, judged for a credential written into it', () => {
  it('is taken where its prose and its names speak of keys, its values judged by their shape alone', async () => {
    const speaking = {
      ...ledgersDocument,
      info: { title: 'Token Service', version: '1' },
      paths: {
        '/entries': {
          get: {
            ...listingEntries.get,
            summary: 'Token for the next page of entries; a key of the service begins sk- or ghp_.',
            parameters: [
              { name: 'password', in: 'query', schema: { type: 'string', example: 'the one the person chose' } },
            ],
          },
        },
      },
    };

    expect(await adding(harness(), givenAs(speaking))).toMatchObject({ status: 'succeeded' });
  });

  it('is taken at exactly 16,384 bytes', async () => {
    const padding = 'x'.repeat(
      16_384 - textOf(withPaths({ '/entries': { get: { ...listingEntries.get, description: '' } } })).length,
    );
    const atTheLimit = textOf(withPaths({ '/entries': { get: { ...listingEntries.get, description: padding } } }));

    expect(Buffer.byteLength(atTheLimit)).toBe(16_384);
    expect(await adding(harness(), givenAs(atTheLimit))).toMatchObject({
      status: 'succeeded',
      output: { document: { bytes: 16_384, tool_count: 1 } },
    });
  });
});

describe('the credential of an HTTP API given its document in document_text', () => {
  it('is refused at its name where it names a security scheme the document does not declare', async () => {
    const credential = { kind: 'secret', name: 'ledgersKey', in: 'security', ...ledgersKeyHelp };

    const { outcome, facts } = await recordedAfter(harness(), givenAs(ledgersDocument, { credential }));

    expect([issuesIn(outcome), facts]).toEqual([
      refusedAt('/credential/name', 'The document declares no security scheme of this name; it declares none'),
      0,
    ]);
  });

  it('is taken where it names a security scheme the document declares, sent as the scheme says', async () => {
    const declaring = {
      ...ledgersDocument,
      components: { securitySchemes: { ledgersKey: { type: 'apiKey', in: 'header', name: 'X-Ledgers-Key' } } },
      security: [{ ledgersKey: [] }],
    };
    const credential = { kind: 'secret', name: 'ledgersKey', in: 'security', ...ledgersKeyHelp };

    expect(await adding(harness(), givenAs(declaring, { credential }))).toMatchObject({
      status: 'succeeded',
      output: { credential: { in: 'security', name: 'ledgersKey' }, document: { tool_count: 2 } },
    });
  });

  it('is refused at the credential where client credentials mint a token no scheme of the document sends', async () => {
    const credential = { kind: 'client_credentials', issuer: 'https://auth.ledgers.example.com', client_id: 'acme' };

    const { outcome, facts } = await recordedAfter(harness(), givenAs(ledgersDocument, { credential }));

    expect([issuesIn(outcome), facts]).toEqual([
      refusedAt(
        '/credential',
        'The document declares no oauth2 or openIdConnect scheme, so no call would send the token this block mints',
      ),
      0,
    ]);
  });
});

const mintingDocument = {
  ...ledgersDocument,
  components: { securitySchemes: { clients: { type: 'oauth2' } } },
  security: [{ clients: [] }],
};

const clientCredentials = { kind: 'client_credentials', issuer: 'https://auth.ledgers.example.com' };

describe('the client id of an HTTP API given its document in document_text, given on the page', () => {
  it('is refused where it looks like a credential, before anything is kept', async () => {
    const h = harness();
    const { id, token } = await added(h, givenAs(mintingDocument, { credential: clientCredentials }));

    const outcome = await h.call(operationNamed(h.operations, 'give_credential'), ada, {
      id,
      token,
      client_id: 'sk-live-0123456789abcdefghij',
      client_secret: 'ledgers-client-secret',
    });

    expect(issuesIn(outcome)).toEqual(
      refusedAt(
        '/client_id',
        "Looks like a credential, which a client id never is: the connection's record keeps the client id in the open, so the secret or the key goes in its own field, where it is sealed",
      ),
    );
    expect(h.secrets.values().size).toBe(0);
  });

  it('connects the connection with a client id that is one', async () => {
    const h = harness();
    const { id, token } = await added(h, givenAs(mintingDocument, { credential: clientCredentials }));

    expect(
      await h.call(operationNamed(h.operations, 'give_credential'), ada, {
        id,
        token,
        client_id: 'acme',
        client_secret: 'ledgers-client-secret',
      }),
    ).toMatchObject({ status: 'succeeded', output: { status: 'connected', credential: { client_id: 'acme' } } });
  });
});

describe('the base_url of an HTTP API given its document in document_text', () => {
  it.each([
    [
      'a private address',
      'https://10.0.0.7/v1',
      'A connection may not reach the host 10.0.0.7, a private address, unless its operator names the host in connections.allowed_hosts',
    ],
    [
      'a loopback address',
      'https://127.0.0.1/v1',
      'A connection may not reach the host 127.0.0.1, a loopback address, unless its operator names the host in connections.allowed_hosts',
    ],
    [
      'the address of cloud metadata',
      'https://169.254.169.254/v1',
      'A connection may not reach the host 169.254.169.254, a cloud metadata address',
    ],
  ] as const)('is refused at %s, asking it nothing and recording nothing', async (_, baseUrl, detail) => {
    const asking = askedThrough();
    const h = harness({ fetch: asking.fetch });

    expect(await recordedAfter(h, { ...ledgers, entry: { ...ledgers.entry, base_url: baseUrl } })).toEqual({
      outcome: { status: 'rejected', reason: 'forbidden', detail },
      facts: 0,
    });
    expect(asking.asked()).toEqual([]);
  });
});

describe('the host of the base_url of an HTTP API given its document in document_text', () => {
  it('is refused where its public name resolves to a private address', async () => {
    const h = harness({ resolve: () => Promise.resolve(['10.4.0.2']) });

    expect(await recordedAfter(h, ledgers)).toEqual({
      outcome: {
        status: 'rejected',
        reason: 'forbidden',
        detail: 'A connection may not reach the host api.ledgers.example.com, which resolves to a private address',
      },
      facts: 0,
    });
  });

  it('is unavailable while the address of its host cannot be looked up', async () => {
    const h = harness({ resolve: () => Promise.reject(Object.assign(new Error('lookup'), { code: 'EAI_AGAIN' })) });

    expect(await recordedAfter(h, ledgers)).toEqual({
      outcome: {
        status: 'rejected',
        reason: 'unavailable',
        detail: `The calls of the HTTP API at ${ledgersBase} cannot be checked now: the address of its host could not be looked up; try again in a moment`,
      },
      facts: 0,
    });
  });

  it('is the one host an allow-list names for it, the hosts inside the document unasked', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: ['api.ledgers.example.com'] }) });

    expect(await adding(h, ledgers)).toMatchObject({ status: 'succeeded' });
  });
});

describe('a call of the document given in document_text that needs a header', () => {
  it('is taken where the header a call needs is given in the entry, or carries the key as the credential', async () => {
    const needingAnAccount = withPaths({
      '/accounts': {
        get: {
          operationId: 'list_accounts',
          parameters: [{ name: 'X-Account', in: 'header', required: true, schema: { type: 'string' } }],
        },
      },
    });
    const inTheEntry = givenAs(needingAnAccount, {
      entry: { base_url: ledgersBase, document_text: textOf(needingAnAccount), headers: { 'X-Account': 'north' } },
    });
    const asTheCredential = givenAs(needingAnAccount, {
      credential: { kind: 'secret', name: 'X-Account', in: 'header', ...ledgersKeyHelp },
    });

    expect([await adding(harness(), inTheEntry), await adding(harness(), asTheCredential)]).toMatchObject([
      { status: 'succeeded', output: { document: { tool_count: 1 } } },
      { status: 'succeeded', output: { document: { tool_count: 1 } } },
    ]);
  });
});

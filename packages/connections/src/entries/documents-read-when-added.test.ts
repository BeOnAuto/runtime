import type { Outcome } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { adding, billing, issuesIn } from '../testing/additions.ts';
import { billingDocument, billingDocumentUrl, documentsOffTheLoopback } from '../testing/harness-services.ts';
import { harness, type Harness } from '../testing/harness.ts';
import { askedThrough } from '../testing/ledgers-documents.ts';

type Answer = () => Response;

interface Answering {
  readonly fetch: typeof globalThis.fetch;
  readonly asked: () => readonly string[];
}

function answering(answers: Readonly<Record<string, Answer>>): Answering {
  const asked: string[] = [];
  return {
    fetch: (...[address]: readonly [unknown, unknown?]) => {
      const url = String(address);
      asked.push(url);
      const answer = Object.hasOwn(answers, url) ? answers[url] : undefined;
      return answer === undefined ? Promise.reject(new TypeError('fetch failed')) : Promise.resolve(answer());
    },
    asked: () => [...asked],
  };
}

function json(document: unknown): Answer {
  return () => Response.json(document);
}

const unbased = { ...billing, entry: { document: billingDocumentUrl } };

function servedAs(document: unknown): Answering {
  return answering({ [billingDocumentUrl]: json(document) });
}

async function noneRecordedAfter(h: Harness, input: unknown): Promise<Outcome> {
  const outcome = await adding(h, input);
  expect(await h.facts()).toEqual([]);
  return outcome;
}

function refusedAt(pointer: string, detail: string): readonly [{ readonly pointer: string; readonly detail: string }] {
  return [{ pointer, detail }];
}

describe('an HTTP API given by hand the address of its document', () => {
  it('reads the document once as it is added, and records as its base_url the first server the document names where the entry names none', async () => {
    const served = askedThrough();
    const h = harness({ fetch: served.fetch });

    expect(await adding(h, unbased)).toMatchObject({
      status: 'succeeded',
      output: { entry: { document: billingDocumentUrl, base_url: 'https://api.billing.example.com/v2' } },
    });
    expect((await h.facts())[0]?.data).toMatchObject({ entry: { base_url: 'https://api.billing.example.com/v2' } });
    expect(served.asked()).toEqual([billingDocumentUrl]);
  });

  it('keeps the base_url the entry names, which wins over the servers of the document', async () => {
    const h = harness({ fetch: servedAs(billingDocument).fetch });
    const elsewhere = { ...billing, entry: { ...billing.entry, base_url: 'https://eu.billing.example.com/v2/' } };

    expect(await adding(h, elsewhere)).toMatchObject({
      output: { entry: { base_url: 'https://eu.billing.example.com/v2/' } },
    });
  });

  it("reads the document through the call's own fetch where the call carries one", async () => {
    const own = answering({});
    const h = harness({ fetch: own.fetch, callFetch: documentsOffTheLoopback });

    expect(await adding(h, unbased)).toMatchObject({ status: 'succeeded' });
    expect(own.asked()).toEqual([]);
  });

  it('holds no document of its own in its fact, reading it from its address each time it is first used', async () => {
    const h = harness();

    await adding(h, billing);

    expect((await h.facts())[0]?.data).not.toHaveProperty('document');
  });
});

const unreadable = [
  [
    'its address answers that it holds none',
    () => new Response('Not found', { status: 404 }),
    'The document could not be read: its URL answered HTTP 404',
  ],
  [
    'its address answers a redirect',
    () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.com/openapi.json' } }),
    'The document could not be read: its URL answered a redirect, HTTP 302, which the runtime does not follow; give the address it redirects to',
  ],
  [
    'it is no OpenAPI document of version 3',
    json({ swagger: '2.0', info: { title: 'Billing', version: '2' }, paths: {} }),
    'At /swagger of the document: not what the runtime reads there in an OpenAPI document of version 3.0 or 3.1',
  ],
  [
    'it is larger than a document of a tool server may be',
    () => new Response('x'.repeat(4_194_305)),
    'The document takes more than the 4194304 bytes a document of a tool server may take',
  ],
] as const;

describe('a document by its address that cannot serve the connection', () => {
  it.each(unreadable)(
    'refuses the addition where %s, at the document, recording nothing and asking for no key',
    async (_, answer, detail) => {
      const h = harness({ fetch: answering({ [billingDocumentUrl]: answer }).fetch });

      expect(await noneRecordedAfter(h, billing)).toEqual({
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The connection cannot be added as it is given',
        issues: refusedAt('/entry/document', detail),
      });
    },
  );
});

describe('a document by its address that cannot be read or offers nothing', () => {
  it('refuses the address of a document the service does not hold, at the document', async () => {
    const missing = { ...billing, entry: { ...billing.entry, document: 'https://billing.example.com/missing.json' } };

    expect(issuesIn(await noneRecordedAfter(harness(), missing))).toEqual(
      refusedAt('/entry/document', 'The document could not be read: its URL answered HTTP 404'),
    );
  });

  it('refuses the addition where the document names no server and the entry no base_url, at base_url', async () => {
    const h = harness({ fetch: servedAs({ ...billingDocument, servers: [] }).fetch });

    expect(issuesIn(await noneRecordedAfter(h, unbased))).toEqual(
      refusedAt('/entry/base_url', 'Expected base_url, since the document names no server'),
    );
  });
});

describe('the hosts a document by its address names', () => {
  it('refuses the address of a document whose public name resolves to a private address, asking it nothing', async () => {
    const served = servedAs(billingDocument);
    const h = harness({ fetch: served.fetch, resolve: () => Promise.resolve(['10.4.0.2']) });

    expect(await noneRecordedAfter(h, billing)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'A connection may not reach the host billing.example.com, which resolves to a private address',
    });
    expect(served.asked()).toEqual([]);
  });

  it('refuses the first server a document names where it is a private address and the entry names no base_url', async () => {
    const h = harness({ fetch: servedAs({ ...billingDocument, servers: [{ url: 'https://10.0.0.9/v2' }] }).fetch });

    expect(await noneRecordedAfter(h, unbased)).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail:
        'A connection may not reach the host 10.0.0.9, a private address, unless its operator names the host in connections.allowed_hosts',
    });
  });

  it('is unavailable while the address of the host of its document cannot be looked up', async () => {
    const h = harness({ resolve: () => Promise.reject(Object.assign(new Error('lookup'), { code: 'EAI_AGAIN' })) });

    expect(await noneRecordedAfter(h, billing)).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: `The document at ${billingDocumentUrl} cannot be read now: the address of its host could not be looked up; try again in a moment`,
    });
  });
});

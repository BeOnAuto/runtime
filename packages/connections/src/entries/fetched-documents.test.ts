import type { Outcome } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { adding, billing, issuesIn } from '../testing/additions.ts';
import { billingDocument, billingDocumentUrl } from '../testing/harness-services.ts';
import { harness, type Harness } from '../testing/harness.ts';

function answered(response: () => Response): typeof globalThis.fetch {
  return () => Promise.resolve(response());
}

const unreachable: typeof globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));

function served(document: unknown): typeof globalThis.fetch {
  return answered(() => Response.json(document));
}

interface Recorded {
  readonly outcome: Outcome;
  readonly facts: number;
}

async function recordedAfter(h: Harness, input: unknown): Promise<Recorded> {
  const outcome = await adding(h, input);
  return { outcome, facts: (await h.facts()).length };
}

const whereTheDocumentComesFrom = {
  pointer: '/entry/document',
  detail:
    "Give document only where the service's own documentation states that address; otherwise write the OpenAPI document from that documentation, describing the calls the job needs, and give it in document_text, with base_url",
};

function cannotBeReadNow(why: string) {
  return {
    outcome: {
      status: 'rejected',
      reason: 'unavailable',
      detail: `The document at ${billingDocumentUrl} cannot be read now: ${why}; try again in a moment`,
    },
    facts: 0,
  };
}

const answeringUntilAborted: typeof globalThis.fetch = (...[address, init]: readonly [unknown, unknown?]) => {
  const { signal } = new Request(String(address), Object.assign({}, init));
  const body = new ReadableStream({
    start: (controller) => {
      signal.addEventListener('abort', () => {
        controller.error(signal.reason);
      });
    },
  });
  return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
};

describe('a document by its address that its service cannot give now', () => {
  it.each([
    ['answers a server error', 503],
    ['answers that it is asked too often', 429],
    ['answers that the request took too long', 408],
  ] as const)('is unavailable where its address %s, recording nothing', async (_, status) => {
    const h = harness({ fetch: answered(() => new Response(null, { status })) });

    expect(await recordedAfter(h, billing)).toEqual(cannotBeReadNow(`its address answered HTTP ${status}`));
  });

  it('is unavailable where its address cannot be reached', async () => {
    const h = harness({ fetch: unreachable });

    expect(await recordedAfter(h, billing)).toEqual(cannotBeReadNow('its address did not answer, or not in time'));
  });

  it('is unavailable where its document does not arrive whole within the time a document is read in', async () => {
    const h = harness({ fetch: answeringUntilAborted });

    expect(await recordedAfter(h, billing)).toEqual(cannotBeReadNow('its address did not answer, or not in time'));
  }, 30_000);
});

describe('the refusal of a document by its address', () => {
  it('names the place of each problem in the document in fixed words, quoting nothing the address answered', async () => {
    const fetched = {
      ...billingDocument,
      paths: { '/invoices': { get: { parameters: [{ name: 'q', in: 'fetched-word-41' }] } } },
    };
    const { outcome, facts } = await recordedAfter(harness({ fetch: served(fetched) }), billing);

    expect([issuesIn(outcome), facts]).toEqual([
      [
        ...['$ref', 'in'].map((member) => ({
          pointer: '/entry/document',
          detail: `At /paths/~1invoices/get/parameters/0/${member} of the document: not what the runtime reads there in an OpenAPI document of version 3.0 or 3.1`,
        })),
        whereTheDocumentComesFrom,
      ],
      0,
    ]);
    expect(JSON.stringify(outcome)).not.toContain('fetched-word-41');
  });
});

describe('the refusal of a document by its address, of what its address answered', () => {
  it('says a text that is neither JSON nor YAML is so, without the reader’s words of its content', async () => {
    const h = harness({ fetch: answered(() => new Response('{"openapi": "3.1.0",\n  paths: [ fetched-word-41')) });

    expect(issuesIn(await adding(h, billing))).toEqual([
      { pointer: '/entry/document', detail: 'The document is neither JSON nor YAML' },
      whereTheDocumentComesFrom,
    ]);
  });

  it('names no security scheme the document declares where the credential names another', async () => {
    const credential = {
      kind: 'secret',
      name: 'billingKey',
      in: 'security',
      instructions: 'Make a key under [Settings, API keys](https://billing.example.com/settings/keys).',
      key_page: 'https://billing.example.com/settings/keys',
    };
    const outcome = await adding(harness(), { ...billing, credential });

    expect(issuesIn(outcome)).toEqual([
      {
        pointer: '/credential/name',
        detail: 'The document declares no security scheme of this name by which a call sends this credential',
      },
    ]);
    expect(JSON.stringify(outcome)).not.toContain('apiKeyAuth');
  });

  it('names no header a scheme of the document places where the entry sends it too', async () => {
    const credential = {
      kind: 'secret',
      name: 'apiKey',
      in: 'security',
      instructions: 'Make a key under [Settings, API keys](https://billing.example.com/settings/keys).',
      key_page: 'https://billing.example.com/settings/keys',
    };
    const sending = { ...billing, entry: { ...billing.entry, headers: { 'X-Billing-Key': 'acme-eu' } }, credential };

    expect(issuesIn(await adding(harness(), sending))).toEqual([
      {
        pointer: '/entry/headers/X-Billing-Key',
        detail: 'Placed by a security scheme of the document; give the credential under security alone',
      },
    ]);
  });
});

describe('the refusal of a document by its address that offers no tool', () => {
  it('counts the operations it leaves out, naming none of them', async () => {
    const needingAnAccount = {
      parameters: [{ name: 'X-Account', in: 'header', required: true, schema: { type: 'string' } }],
    };
    const paths = Object.fromEntries(
      ['invoices', 'payments', 'refunds'].map((noun) => [
        `/${noun}`,
        { get: { operationId: `list_${noun}`, ...needingAnAccount } },
      ]),
    );
    const outcome = await adding(harness({ fetch: served({ ...billingDocument, paths }) }), billing);

    expect(issuesIn(outcome)).toEqual([
      {
        pointer: '/entry/document',
        detail: 'The document offers no tool the runtime can call: it leaves out each of its 3 operations',
      },
      whereTheDocumentComesFrom,
    ]);
    expect(JSON.stringify(outcome)).not.toMatch(/list_|X-Account/u);
  });
});

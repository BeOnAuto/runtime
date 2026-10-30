import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  connectionFailure,
  jsonResponse,
  recordingFetch,
  type Responder,
} from '../provider-testing/recording-fetch.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { catalogFor, type CatalogHarness } from '../testing/catalog-harness.ts';

const environment = {
  MODEL_GATEWAYS: JSON.stringify([
    { name: 'gateway', base_url: 'https://llm.internal.example/v1', api_key_env: 'KEY' },
  ]),
  KEY: 'gateway-secret-key-0042',
};

async function failedListing(responder: Responder): Promise<CatalogHarness> {
  const catalog = await catalogFor(environment, responder);
  expect(await catalog.list()).toMatchObject({ data: [], catalog_status: 'partial' });
  return catalog;
}

function hintOf(reason: string): object {
  return {
    provider: 'gateway',
    model: null,
    hint: `The list of models of gateway could not be read: ${reason}`,
    run_id: null,
  };
}

describe('a list of models the provider answers with an error', () => {
  it('is left out, and its message goes to the operator with every secret of the settings redacted', async () => {
    const catalog = await failedListing(() =>
      jsonResponse({ error: { message: 'Invalid key gateway-secret-key-0042 for tenant' } }, 401),
    );

    expect(catalog.reports()).toEqual([
      {
        provider: 'gateway',
        model: null,
        status: 401,
        message: '{"error":{"message":"Invalid key [redacted] for tenant"}}',
        run_id: null,
      },
    ]);
    expect(catalog.hints()).toEqual([]);
  });

  it('gives the operator at most 2000 characters, or says when there was no message or too long a one', async () => {
    const long = await failedListing(() => new Response('x'.repeat(5000), { status: 500 }));
    const empty = await failedListing(() => new Response('   ', { status: 503 }));
    const huge = await failedListing(() => new Response('x'.repeat(70_000), { status: 502 }));

    expect(long.reports()[0]?.message).toBe('x'.repeat(2000));
    expect(empty.reports()[0]?.message).toBe('The answer had no message');
    expect(huge.reports()[0]?.message).toBe('The answer was larger than 64 KiB');
  });
});

describe('a list of models that cannot be read', () => {
  it.each([
    ['the provider cannot be reached', () => connectionFailure('ECONNREFUSED'), 'it could not be reached'],
    [
      'the provider does not answer in time',
      () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
      'it did not answer within 10 seconds',
    ],
    [
      'the certificate of the provider is not trusted',
      () => connectionFailure('SELF_SIGNED_CERT_IN_CHAIN'),
      'its TLS certificate is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS',
    ],
    ['the answer is not JSON', () => new Response('<html>Bad gateway</html>'), 'its answer is not JSON'],
    ['the answer has no body', () => new Response(null), 'its answer is not JSON'],
    ['the answer is not a list of models', () => jsonResponse({ models: [] }), 'its answer is not a list of models'],
    ['the answer is larger than 8 MiB', () => new Response('x'.repeat(8_388_609)), 'its answer is larger than 8 MiB'],
  ])('is left out when %s, and the operator is told why', async (_case, responder: Responder, reason) => {
    const catalog = await failedListing(responder);

    expect(catalog.hints()).toEqual([hintOf(reason)]);
    expect(catalog.reports()).toEqual([]);
  });

  it('is left out when it has more pages than are read', async () => {
    const page = { data: [{ id: 'claude-sonnet-4-5' }], has_more: true, last_id: 'claude-sonnet-4-5' };
    const catalog = await catalogFor({ ANTHROPIC_API_KEY: 'sk-ant-key' }, () => jsonResponse(page));

    expect(await catalog.list()).toMatchObject({ data: [], catalog_status: 'partial' });
    expect(catalog.requests()).toHaveLength(10);
    expect(catalog.hints()).toEqual([
      {
        provider: 'anthropic',
        model: null,
        hint: 'The list of models of anthropic could not be read: it has more than 10 pages of models',
        run_id: null,
      },
    ]);
  });
});

const anthropicUnreachableGatewayFailing: Responder = ({ url }) =>
  url.startsWith('https://api.anthropic.com/') ? connectionFailure('ECONNRESET') : jsonResponse({}, 500);

describe('a list of models that fails on a server that reports nothing', () => {
  it('is left out all the same', async () => {
    const recording = recordingFetch(anthropicUnreachableGatewayFailing);
    const access = await accessFor({ ...environment, ANTHROPIC_API_KEY: 'sk-ant-key' }, { fetch: recording.fetch });

    expect(await Effect.runPromise(access.catalog.list())).toMatchObject({
      data: [],
      catalog_status: 'partial',
    });
    expect(recording.requests()).toHaveLength(2);
  });
});

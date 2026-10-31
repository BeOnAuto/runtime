import { Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { documentOf, toolsOf } from '../api-testing/derived-documents.ts';
import { defaultTiming } from '../bounds/call-bounds.ts';
import type { CallSettled } from '../clients/server-client.ts';
import { failureOf } from '../clients/server-failures.ts';
import { serveFakeApi, type FakeApiServer } from '../testing/served-fakes.ts';
import { apiClient } from './api-client.ts';
import type { ApiOperation } from './api-tools.ts';
import type { DescribedApiSettings } from './described-api.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function elsewhere(): Promise<FakeApiServer> {
  const fake = await serveFakeApi({ key: apiKey });
  closing.push(fake.close);
  return fake;
}

function searchAt(path: string): ApiOperation {
  return {
    tool: { name: 'search', inputSchema: {} },
    method: 'get',
    path,
    inputs: [],
    body: null,
    credentials: [],
    answers: { schemas: [], components: {}, headers: {}, describesNoBody: false },
  };
}

function calledAt(baseUrl: string, path: string): Promise<CallSettled> {
  const client = apiClient(
    {
      ...settings,
      headers: new Map([['X-Api-Key', Redacted.make(apiKey)]]),
      api: { baseUrl, operations: [searchAt(path)] },
    },
    { fetch: globalThis.fetch, tokens: undefined, now: Date.now },
  );
  return client.call({
    tool: 'search',
    input: {},
    meta: {},
    signal: new AbortController().signal,
    timeoutMs: defaultTiming.callMs,
  });
}

const outsideTheBase = {
  kind: 'failing',
  message: 'The bridge built an address outside base_url for this call, a defect of the runtime, and sent nothing',
};

function failureOfSettled(settled: CallSettled): unknown {
  return 'error' in settled ? failureOf(settled.error) : settled;
}

const settings: DescribedApiSettings = {
  type: 'openapi',
  name: 'graph',
  document: { kind: 'url', url: 'https://graph.example.com/openapi.json' },
  base_url: null,
  headers: new Map(),
  query_params: new Map(),
  security: new Map(),
  auth: null,
  orgs: ['acme'],
  playbooks: null,
  allowed: null,
  record_content: true,
  request_id: null,
  secrets: [],
  connection: null,
  provider: null,
  api: { baseUrl: 'https://graph.example.com/v1', operations: [] },
};

describe('the client of an HTTP API', () => {
  it('refuses a call of a tool its document does not hold, sending nothing', async () => {
    const sent: string[] = [];
    const client = apiClient(settings, {
      fetch: () => {
        sent.push('a request');
        return Promise.resolve(new Response('{}'));
      },
      tokens: undefined,

      now: Date.now,
    });

    const settled = await client.call({
      tool: 'search',
      input: {},
      meta: {},
      signal: new AbortController().signal,
      timeoutMs: defaultTiming.callMs,
    });

    expect(failureOfSettled(settled)).toEqual({
      kind: 'refused',
      message: 'The tool server lists no tool search',
    });
    expect(sent).toEqual([]);
  });
});

describe('the tools the client of an HTTP API lists', () => {
  it('are those of its document, saying of one whose described answers have no body that it answers none', async () => {
    const operations = toolsOf(
      documentOf({
        '/notes': {
          post: { operationId: 'addNote', responses: { '201': { description: 'Added' } } },
          get: { operationId: 'listNotes', responses: { '200': { content: { 'application/json': {} } } } },
        },
      }),
    ).operations;
    const client = apiClient(
      { ...settings, api: { ...settings.api, operations } },
      { fetch: globalThis.fetch, tokens: undefined, now: Date.now },
    );

    const listed = await client.listTools(defaultTiming.openMs);

    expect(listed.map(({ name, answersNoBody }) => [name, answersNoBody])).toEqual([
      ['listNotes', undefined],
      ['addNote', true],
    ]);
  });
});

describe('the end of the client of an HTTP API', () => {
  it('closes it, holding no session', async () => {
    const client = apiClient(settings, {
      fetch: globalThis.fetch,
      tokens: undefined,

      now: Date.now,
    });

    await client.end();

    await expect(client.closed).resolves.toBeUndefined();
    expect(await client.listTools(defaultTiming.openMs)).toEqual([]);
  });
});

describe('the address of a call of an HTTP API, checked before it is sent', () => {
  it('sends nothing, and no key, to another port that a path read into base_url would name', async () => {
    const other = await elsewhere();
    const port = new URL(other.origin).port;

    const settled = await calledAt(`http://127.0.0.1:${port.slice(0, -1)}`, `${port.slice(-1)}/v1/search`);

    expect(failureOfSettled(settled)).toEqual(outsideTheBase);
    expect(other.seen()).toEqual([]);
  });

  it('sends nothing to a path beside the path of base_url, which a path that does not begin with / names', async () => {
    const other = await elsewhere();

    const settled = await calledAt(`${other.origin}/v1/inner`, 'most/search');

    expect(failureOfSettled(settled)).toEqual(outsideTheBase);
    expect(other.seen()).toEqual([]);
  });
});

function calledThrough(
  baseUrl: string,
  document: ReturnType<typeof documentOf>,
  tool: string,
  input: Readonly<Record<string, unknown>>,
): Promise<CallSettled> {
  const client = apiClient(
    {
      ...settings,
      headers: new Map([['X-Api-Key', Redacted.make(apiKey)]]),
      api: { baseUrl, operations: toolsOf(document).operations },
    },
    { fetch: globalThis.fetch, tokens: undefined, now: Date.now },
  );
  return client.call({ tool, input, meta: {}, signal: new AbortController().signal, timeoutMs: defaultTiming.callMs });
}

const unexploded = documentOf({
  '/rows': {
    get: {
      operationId: 'rows',
      parameters: [{ name: 'tag', in: 'query', style: 'form', explode: false, schema: { type: 'array' } }],
    },
  },
});

describe('the query of a call of an HTTP API whose document writes a list with explode false', () => {
  it('reaches the API as one key, its items joined by commas and a comma inside an item encoded', async () => {
    const api = await elsewhere();

    const settled = await calledThrough(api.baseUrl, unexploded, 'rows', { tag: ['open', 'mine, too'] });

    expect(settled).toMatchObject({ result: { structuredContent: { tags: ['open,mine, too'] } } });
    expect(api.seen()).toMatchObject([{ path: '/v1/rows', query: '?tag=open,mine%2C+too' }]);
  });
});

const profiles = documentOf({
  '/profiles/{id}': {
    get: {
      operationId: 'profile',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    },
  },
});

describe('the path of a call of an HTTP API whose argument holds a /', () => {
  it('reaches the API with the argument encoded inside its one segment, and so at no route above it', async () => {
    const api = await elsewhere();

    const settled = await calledThrough(api.baseUrl, profiles, 'profile', { id: '../search' });

    expect(settled).toMatchObject({
      result: { isError: true, content: [{ type: 'text', text: 'No such route: GET /v1/profiles/..%2Fsearch' }] },
    });
    expect(api.seen()).toMatchObject([{ method: 'GET', path: '/v1/profiles/..%2Fsearch' }]);
  });
});

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { CalledOnce } from '../one-call/called-once.ts';
import { describedAccess, type ClientRegistration } from '../testing/index.ts';
import { serveFakeApi, type FakeApiOptions, type FakeApiServer } from '../testing/served-fakes.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const clientSecret = 'graph-client-secret-81c2';

const timing = { callMs: 20_000, openMs: 20_000, longestRetryWaitMs: 1000 };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeApi(options: FakeApiOptions = {}): Promise<FakeApiServer> {
  const fake = await serveFakeApi({ key: apiKey, ...options });
  closing.push(fake.close);
  return fake;
}

async function accessTo(entry: Readonly<Record<string, unknown>>) {
  const reporting = await describedAccess(
    { graph: { org: 'acme', ...entry } },
    { environment: { GRAPH_API_KEY: apiKey, GRAPH_CLIENT_SECRET: clientSecret }, timing },
  );
  closing.push(reporting.access.close);
  return reporting.access;
}

function keyed(fake: FakeApiServer) {
  return { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' } };
}

function called(
  access: Awaited<ReturnType<typeof accessTo>>,
  tool: string,
  input: Readonly<Record<string, unknown>> = {},
): Promise<CalledOnce> {
  return Effect.runPromise(
    access.callOnce({
      org: 'acme',
      playbook: 'alpha',
      reference: { server: 'graph', tool },
      input,
      meta: { 'auto.on/run_id': 'run-1' },
    }),
  );
}

function answerOf(answered: CalledOnce): unknown {
  return 'answer' in answered ? answered.answer : answered;
}

const searchTool: unknown = expect.arrayContaining([
  expect.objectContaining({
    name: 'search',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }),
]);

async function authorized(registration: Partial<ClientRegistration> = {}) {
  const fake = await fakeApi({
    client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600, ...registration },
  });
  const issuer = String(fake.issuing?.issuer);
  const access = await accessTo({
    document: fake.documentUrl,
    auth: { issuer, client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' },
  });
  return { fake, issuer, access };
}

describe('the request of a call of a tool of an HTTP API', () => {
  it('fills the path, the query with repeated keys and the body, and sends no metadata of the run', async () => {
    const fake = await fakeApi();
    const access = await accessTo(keyed(fake));

    const updated = await called(access, 'updateProfile', { id: 'ada', body: { name: 'Ada', title: null } });
    const rows = await called(access, 'rows', { tag: ['open', 'mine'] });
    const [put, get] = fake.seen();

    expect(updated).toMatchObject({
      outcome: 'result',
      answer: { structuredContent: { updated: { name: 'Ada', title: null } } },
    });
    expect(rows).toMatchObject({ outcome: 'result', answer: { structuredContent: { tags: ['open', 'mine'] } } });
    expect(put).toMatchObject({
      method: 'PUT',
      path: '/v1/profiles/ada',
      body: '{"name":"Ada","title":null}',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': apiKey },
    });
    expect(get).toMatchObject({ method: 'GET', path: '/v1/rows', query: '?tag=open&tag=mine', body: '' });
  });

  it('scrubs a key of its query from an answer that echoes the address, in the form the address carried it', async () => {
    const formKey = 'k3y+With/Slash=Pad==';
    const fake = await fakeApi({ key: formKey });
    const reporting = await describedAccess(
      { graph: { org: 'acme', document: fake.documentUrl, security: { queryKey: '${GRAPH_API_KEY}' } } },
      { environment: { GRAPH_API_KEY: formKey }, timing },
    );
    closing.push(reporting.access.close);

    expect(await called(reporting.access, 'removeProfile', { id: 'eve' })).toMatchObject({
      outcome: 'tool_error',
      detail: 'No such route: DELETE /v1/profiles/eve?api_key=[redacted]',
    });
    expect(fake.seen()[0]?.query).toBe('?api_key=k3y%2BWith%2FSlash%3DPad%3D%3D');
  });
});

describe('a call of an operation of an HTTP API that needs a header', () => {
  it('sends a header the operation needs from the headers of its entry, which give the model no input for it', async () => {
    const fake = await fakeApi();
    const session = { 'x-session': 'session-of-acme' };
    const access = await accessTo({ ...keyed(fake), headers: session });

    const answered = await called(access, 'sessionState');

    expect(answered).toMatchObject({
      outcome: 'result',
      answer: { structuredContent: { session: 'session-of-acme' } },
    });
    expect(fake.seen()[0]).toMatchObject({ path: '/v1/sessions', query: '', headers: session });
  });
});

describe('the query of a call of a tool of an HTTP API', () => {
  it('carries the query parameters of its entry beside the key its security scheme places in the query', async () => {
    const fake = await fakeApi();
    const access = await accessTo({
      document: fake.documentUrl,
      query_params: { tenant: 'acme-eu' },
      security: { queryKey: '${GRAPH_API_KEY}' },
    });

    expect(await called(access, 'search', { query: 'acme' })).toMatchObject({ outcome: 'result' });
    expect(fake.seen()[0]?.query).toBe(`?query=acme&tenant=acme-eu&api_key=${apiKey}`);
  });
});

describe('the answer of a call of a tool of an HTTP API', () => {
  it('answers JSON as structured content and its text, text as text, another media type noted and not shown, and nothing as no content', async () => {
    const fake = await fakeApi();
    const access = await accessTo(keyed(fake));

    const answers = await Promise.all([
      called(access, 'get_profiles_id', { id: 'ada' }),
      called(access, 'search', { query: 'acme' }),
      called(access, 'photo'),
      called(access, 'notes'),
    ]);

    expect(answers.map((answer) => answerOf(answer))).toEqual([
      { content: [{ type: 'text', text: '{"name":"Ada","rows":2}' }], structuredContent: { name: 'Ada', rows: 2 } },
      { content: [{ type: 'text', text: 'Found 2 rows for acme.' }] },
      { content: [{ type: 'binary', mimeType: 'image/png' }] },
      { content: [] },
    ]);
  });

  it('answers a missing resource as an error result carrying what the API said, not as a failure of the server', async () => {
    const fake = await fakeApi();
    const access = await accessTo(keyed(fake));
    fake.answerNextWith({ status: 404, body: '{"title":"No profile named eve"}' });

    expect(await called(access, 'get_profiles_id', { id: 'eve' })).toMatchObject({
      outcome: 'tool_error',
      detail: '{"title":"No profile named eve"}',
      answered: { is_error: true, jsonrpc_id: null },
    });
    expect(await called(access, 'removeProfile', { id: 'eve' })).toMatchObject({
      outcome: 'tool_error',
      detail: 'No such route: DELETE /v1/profiles/eve',
    });
  });
});

describe('a call of a tool of an HTTP API that answers a redirect', () => {
  it('is an error result with its status, sending nothing and no key to the address the redirect names', async () => {
    const fake = await fakeApi();
    const elsewhere = await fakeApi();
    const access = await accessTo(keyed(fake));
    fake.answerNextWith({ status: 307, headers: { location: `${elsewhere.baseUrl}/search?query=acme` } });

    expect(await called(access, 'search', { query: 'acme' })).toMatchObject({
      outcome: 'tool_error',
      detail: 'The tool server answered a redirect, HTTP 307, which a call does not follow',
      answered: { is_error: true, jsonrpc_id: null },
    });
    expect(fake.seen()).toHaveLength(1);
    expect(elsewhere.seen()).toEqual([]);
  });
});

describe('a call of a tool of an HTTP API that fails', () => {
  it('fails a call its API does not accept the key of, as a key the server refused', async () => {
    const fake = await fakeApi();
    const access = await accessTo({ document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_CLIENT_SECRET}' } });

    expect(await called(access, 'search', { query: 'acme' })).toMatchObject({
      outcome: 'server_failure',
      detail: 'The tool server answered HTTP 401',
      failed: { because: 'server_failure', jsonrpc_id: null },
    });
  });

  it('refuses arguments it cannot send, sending nothing', async () => {
    const fake = await fakeApi();
    const access = await accessTo(keyed(fake));

    expect(await called(access, 'get_profiles_id', { name: 'ada' })).toMatchObject({
      outcome: 'arguments_refused',
      detail: 'The arguments give name, which this operation does not take',
    });
    expect(await called(access, 'get_profiles_id', { id: '..' })).toMatchObject({
      outcome: 'arguments_refused',
      detail: 'The path arguments would take the call out of the path of this operation, as a . or a .. does',
    });
    expect(fake.seen()).toEqual([]);
  });

  it('fails a call its API cannot be reached for', async () => {
    const fake = await fakeApi();
    const gone = await serveFakeApi();
    await gone.close();
    const access = await accessTo({ ...keyed(fake), base_url: gone.baseUrl });

    expect(await called(access, 'search', { query: 'acme' })).toMatchObject({
      outcome: 'server_failure',
      detail: 'The tool server could not be reached',
    });
  });
});

describe('the listing of the tools of an HTTP API', () => {
  it('lists its tools from the document alone, asking the API nothing', async () => {
    const fake = await fakeApi();
    const access = await accessTo(keyed(fake));

    const [listed] = await Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));

    expect(listed).toMatchObject({
      name: 'graph',
      type: 'openapi',
      tools: searchTool,
    });
    expect(fake.seen()).toEqual([]);
  });
});

describe('the token of an HTTP API with an auth block', () => {
  it('is minted from the metadata of the pinned issuer, which the API itself has none of', async () => {
    const { fake, issuer, access } = await authorized();

    expect(await called(access, 'search', { query: 'acme' })).toMatchObject({ outcome: 'result' });
    expect(fake.issuing?.tokenRequests()).toBe(1);
    expect(issuer).not.toBe(fake.origin);
    expect(fake.seen().map(({ path }) => path)).toEqual([
      '/.well-known/oauth-protected-resource/v1',
      '/.well-known/oauth-protected-resource',
      '/v1/search',
    ]);
    expect(fake.seen().at(-1)?.headers['authorization']).toMatch(/^Bearer token-1-/u);
  });

  it('is minted from an issuer that publishes its metadata by OpenID Connect discovery alone', async () => {
    const { fake, access } = await authorized({ openIdConnect: true });

    expect(await called(access, 'search', { query: 'acme' })).toMatchObject({ outcome: 'result' });
    expect(fake.issuing?.tokenRequests()).toBe(1);
  });

  it('is minted once more when the API answers 401, and a second 401 is a key the server refused', async () => {
    const { fake, access } = await authorized();
    await called(access, 'search', { query: 'acme' });
    fake.issuing?.revokeTokens();

    expect(await called(access, 'search', { query: 'acme' })).toMatchObject({ outcome: 'result' });
    fake.answerNextWith({ status: 401 }, 2);
    expect(await called(access, 'search', { query: 'acme' })).toMatchObject({
      outcome: 'server_failure',
      detail: 'The tool server answered HTTP 401',
    });
    expect(fake.issuing?.tokenRequests()).toBe(3);
  });
});

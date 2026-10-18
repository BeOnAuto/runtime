import { Effect, Option, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { documentWithServer, servedDocumentAt } from '../api-testing/described-documents.ts';
import { fakeConnections, type FakeConnection } from '../testing/fake-connections.ts';
import {
  fakeApiKey,
  patientTiming,
  playbookToolCalls,
  recordingCallJournal,
  serveFakeApi,
  toolRun,
} from '../testing/index.ts';
import { describedAccess } from '../testing/reporting-access.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const environment = { GRAPH_API_KEY: fakeApiKey };

const rule = 'A connection may not reach the host api.billing.example.org on this runtime, which allows *.example.com';

const SucceededSchema = Schema.Struct({ output: Schema.Unknown });

const listedTools: unknown = expect.any(Array);

const notReadable: unknown = expect.stringContaining(
  'The tool server graph could not be used: The document is neither JSON nor YAML',
);

const unsecured = JSON.stringify({ openapi: '3.1.0', info: { title: 'Graph', version: '1.0.0' }, paths: {} });

const declaresNoScheme: unknown = expect.stringContaining('The document declares no security scheme of this name');

function unavailable(): Response {
  return new Response('Down for maintenance', { status: 503 });
}

function inTurn(answers: readonly Response[]): () => Promise<Response> {
  const left = [...answers];
  return () => Promise.resolve(Option.getOrThrow(Option.fromNullishOr(left.shift())));
}

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function accessThrough(connection: Omit<FakeConnection, 'id' | 'name' | 'environment'>) {
  const connections = fakeConnections();
  connections.connect('acme', { id: 'graph-id', name: 'graph', environment, ...connection });
  const { access } = await describedAccess({}, { environment, timing: patientTiming, connections });
  closing.push(access.close);
  return access;
}

async function apiOutsideTheRule() {
  const fake = await serveFakeApi({ key: fakeApiKey });
  closing.push(fake.close);
  return accessThrough({
    entry: { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' } },
    reaches: (url) => (new URL(url).pathname.startsWith('/v1') ? rule : undefined),
  });
}

describe('a connection to an HTTP API whose document cannot be read', () => {
  it('is unavailable as failing in the words of its document, and its document is read again when next it is used', async () => {
    const documentUrl = await servedDocumentAt(
      inTurn([
        unavailable(),
        unavailable(),
        unavailable(),
        new Response(documentWithServer('https://api.example.com/v1')),
      ]),
    );
    const access = await accessThrough({
      entry: { document: documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' } },
    });

    const failing = await Effect.runPromise(access.listServers(alpha));
    const unopened = await Effect.runPromise(
      access.callOnce({ ...alpha, reference: { server: 'graph', tool: 'search' }, input: {}, meta: {} }),
    );
    const notOpened = await Effect.runPromise(
      Effect.flip(access.open(toolRun(recordingCallJournal()), [{ server: 'graph', tool: 'search' }])),
    );
    const read = await Effect.runPromise(access.listServers(alpha));

    expect(failing).toMatchObject([
      {
        name: 'graph',
        because: 'failing',
        unavailable:
          'The tool server graph could not be used: The document could not be read: its URL answered HTTP 503',
      },
    ]);
    expect(unopened).toMatchObject({ kind: 'unopened', refused: 'tool_server_failed', because: 'failing' });
    expect(notOpened).toMatchObject({ _tag: 'tool_server_failed', because: 'failing' });
    expect(read).toMatchObject([{ name: 'graph', connection: 'graph-id', tools: listedTools }]);
  });
});

describe('a connection to an HTTP API whose entry gives a header its document says an operation needs', () => {
  it('offers the operation, and a call of it sends the header', async () => {
    const fake = await serveFakeApi({ key: fakeApiKey });
    closing.push(fake.close);
    const access = await accessThrough({
      entry: {
        document: fake.documentUrl,
        headers: { 'X-Session': 'session-of-acme' },
        security: { apiKeyAuth: '${GRAPH_API_KEY}' },
      },
    });

    const called = await Effect.runPromise(
      access.callOnce({ ...alpha, reference: { server: 'graph', tool: 'sessionState' }, input: {}, meta: {} }),
    );

    expect(called).toMatchObject({ outcome: 'result', answer: { structuredContent: { session: 'session-of-acme' } } });
  });
});

describe('a connection to an HTTP API whose document is refused for what it says', () => {
  it('is unavailable as failing in the words of its document, which is not read again for as long as the runtime runs', async () => {
    const reads = { made: 0 };
    const documentUrl = await servedDocumentAt(() => {
      reads.made += 1;
      return Promise.resolve(new Response(unsecured));
    });
    const access = await accessThrough({
      entry: { document: documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' } },
    });

    const first = await Effect.runPromise(access.listServers(alpha));
    const second = await Effect.runPromise(access.listServers(alpha));

    expect(first).toMatchObject([{ name: 'graph', because: 'failing', unavailable: declaresNoScheme }]);
    expect(second).toEqual(first);
    expect(reads.made).toBe(1);
  });
});

describe('a connection to an HTTP API whose document address answers a page that is not a document', () => {
  it('is unavailable as failing in the words of the reading, and is read again when next it is used', async () => {
    const documentUrl = await servedDocumentAt(
      inTurn([
        new Response('<html><body>Bad gateway</body></html>', { status: 200 }),
        new Response(documentWithServer('https://api.example.com/v1')),
      ]),
    );
    const access = await accessThrough({
      entry: { document: documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' } },
    });

    const first = await Effect.runPromise(access.listServers(alpha));
    const second = await Effect.runPromise(access.listServers(alpha));

    expect(first).toMatchObject([{ name: 'graph', because: 'failing', unavailable: notReadable }]);
    expect(second).toMatchObject([{ name: 'graph', connection: 'graph-id', tools: listedTools }]);
  });
});

describe('a tool of a connection whose document names an address the rules do not allow', () => {
  it('is not described, and a dry run says why it would not be made', async () => {
    const { call, registrations } = playbookToolCalls(await apiOutsideTheRule());
    const asked = { server: 'graph', tool: 'search' };

    const described = await call('introspect', asked);
    const dryRun = Schema.decodeUnknownSync(SucceededSchema)(await call('dry_run', asked));

    expect(described).toMatchObject({
      reason: 'unavailable',
      kind: 'tool_not_offered',
      because: 'connection_not_allowed',
      detail: rule,
    });
    expect(dryRun.output).toMatchObject({
      would_run: false,
      server: { reachable: 'no', because: 'connection_not_allowed' },
    });
    expect(registrations.dry_run.plainLanguage?.outcome(dryRun.output, asked)).toContain(
      'the rules whoever runs this server sets for connections do not allow its tool server',
    );
  });

  it('is listed by search with the connection, in the words of the rule', async () => {
    const { call, registrations } = playbookToolCalls(await apiOutsideTheRule());

    const searched = Schema.decodeUnknownSync(SucceededSchema)(await call('search', {}));

    expect(searched.output).toMatchObject({
      servers: [{ name: 'graph', connection: 'graph-id', because: 'connection_not_allowed' }],
    });
    expect(registrations.search.plainLanguage?.outcome(searched.output, {})).toContain(
      `“graph” cannot be used: ${rule}.`,
    );
  });
});

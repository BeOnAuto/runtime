import { notedMcpCall, type ApiEnv } from '@on.auto/api';
import { readNamed, statementStarted } from '@on.auto/ledger/store-reads';
import { Effect, References } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logStoreReads, storeReadsOfRequests, storeReadsWatched, type RequestReads } from './store-reads-logging.ts';

function steppedClock(...times: readonly number[]): () => number {
  const left = [...times];
  return () => left.shift() ?? Number.NaN;
}

function statementReading(rows: number): Promise<void> {
  statementStarted()?.({ rowsRead: rows, rowsWritten: 0 });
  return Promise.resolve();
}

function readsOfAnActivityPage(): Promise<void> {
  return readNamed('activity_2', () => statementReading(4))
    .then(() =>
      readNamed(
        'fold:org.playbooks',
        () => statementReading(9),
        () => 9,
      ),
    )
    .then(() => readNamed('comments_3', () => statementReading(1)));
}

function anApiReporting(most?: number) {
  const reported: RequestReads[] = [];
  const reportedOnce = Promise.withResolvers<void>();
  const app = new Hono<ApiEnv>();
  app.use(
    storeReadsOfRequests({
      report: (reads) => {
        reported.push(reads);
        reportedOnce.resolve();
      },
      clock: steppedClock(0, 2, 10, 11, 20, 25),
      ...(most === undefined ? {} : { most }),
    }),
  );
  app.get('/v1/orgs/:org/activity', async (c) => {
    await readsOfAnActivityPage();
    return c.json({ items: [] });
  });
  app.get('/health', (c) => c.text('ok'));
  const toolAnswers = Promise.withResolvers<void>();
  app.post('/orgs/:org/mcp', (c) => {
    const noting = notedMcpCall({ method: 'tools/call', tool: 'list_playbooks', request_bytes: 80 });
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    void toolAnswers.promise
      .then(() => readNamed('fold:org.playbooks', () => statementReading(3)))
      .then(() => {
        noting?.bytes(12);
        noting?.heard({ jsonrpc: '2.0', id: 1, result: { isError: true } });
        noting?.ended();
        return writable.close();
      });
    return c.body(readable, 200, { 'content-type': 'text/event-stream' });
  });
  return { app, reported, toolAnswers, reportedOnce: reportedOnce.promise };
}

describe('the reads of the store of each request, on the Node shell', () => {
  it('reports a request by its method, its route as declared, its status and its reads by name, timed', async () => {
    const { app, reported } = anApiReporting();

    await app.request('/v1/orgs/acme/activity?kind=needs_you');

    expect(reported).toEqual([
      {
        method: 'GET',
        route: '/v1/orgs/:org/activity',
        status: 200,
        reads: {
          activity_2: { n: 1, rows: 4, ms: 2 },
          'fold:org.playbooks': { n: 1, rows: 9, events: 9, ms: 1 },
          comments_3: { n: 1, rows: 1, ms: 5 },
        },
      },
    ]);
  });

  it('keeps the heaviest reads by rows and sums the rest as other', async () => {
    const { app, reported } = anApiReporting(1);

    await app.request('/v1/orgs/acme/activity');

    expect(reported.map(({ reads }) => reads)).toEqual([
      { 'fold:org.playbooks': { n: 1, rows: 9, events: 9, ms: 1 }, other: { n: 2, rows: 5, ms: 7 } },
    ]);
  });
});

describe('the reads of the store of a request to an MCP endpoint, on the Node shell', () => {
  it('reports an MCP call as its answer ends, by what it named, with the reads its tool made while it streamed', async () => {
    const { app, reported, toolAnswers, reportedOnce } = anApiReporting();

    const answer = await app.request('/orgs/acme/mcp', { method: 'POST' });
    const before = [...reported];
    toolAnswers.resolve();
    await answer.text();
    await reportedOnce;

    expect(before).toEqual([]);
    expect(reported).toEqual([
      {
        method: 'POST',
        route: '/orgs/:org/mcp',
        status: 200,
        reads: { 'fold:org.playbooks': { n: 1, rows: 3, ms: 2 } },
        mcp: { method: 'tools/call', tool: 'list_playbooks', request_bytes: 80, response_bytes: 12, tool_errors: 1 },
      },
    ]);
  });
});

describe('the requests the Node shell reports nothing of', () => {
  it('reports nothing of a request that read nothing of the store', async () => {
    const { app, reported } = anApiReporting();

    await app.request('/health');

    expect(reported).toEqual([]);
  });
});

describe('the line of the reads of a request', () => {
  it('logs the reads of a request at the debug level, by names and numbers alone', async () => {
    const reads: RequestReads = {
      method: 'GET',
      route: '/v1/orgs/:org/activity',
      status: 200,
      reads: { activity_2: { n: 1, rows: 4, ms: 2 } },
    };

    const lines = await linesLoggedBy(
      logStoreReads(reads).pipe(Effect.provideService(References.MinimumLogLevel, 'Debug')),
    );

    expect(lines.map((line): unknown => JSON.parse(line))).toEqual([
      expect.objectContaining({ level: 'DEBUG', annotations: { store_reads: reads } }),
    ]);
  });
});

function anApiWatched(logLevel: 'debug' | 'info', traced: boolean) {
  const logged: Effect.Effect<void>[] = [];
  const watched = storeReadsWatched({
    logLevel,
    traced,
    run: (log) => {
      logged.push(log);
    },
  });
  const app = new Hono<ApiEnv>();
  if (watched !== undefined) {
    app.use(watched);
  }
  app.get('/read', async (c) => {
    await readNamed('activity_2', () => statementReading(1));
    return c.text('read');
  });
  return { app, watched, logged };
}

describe('the reads of the store a server watches', () => {
  it('logs each request that read the store where the server logs at the debug level', async () => {
    const { app, logged } = anApiWatched('debug', false);

    await app.request('/read');

    expect(logged).toHaveLength(1);
  });

  it('watches the reads of a traced request without logging them at any other level', async () => {
    const { app, watched, logged } = anApiWatched('info', true);

    await app.request('/read');

    expect([watched === undefined, logged]).toEqual([false, []]);
  });

  it('watches nothing where the server neither logs at the debug level nor traces its requests', () => {
    expect(anApiWatched('info', false).watched).toBeUndefined();
  });
});

import { documentsReadIn, type DocumentReading, type ReadingBounds } from '@on.auto/documents';
import { processPool } from '@on.auto/workflow-engine/dsl';
import { describe, expect, it } from 'vitest';

import { apiKey, called, closedAfter, fakeApi, keyed } from '../api-testing/api-calls.ts';
import { describedAccess } from '../testing/reporting-access.ts';
import { apiClient } from './api-client.ts';
import type { DescribedApiSettings } from './described-api.ts';

const mebibyte = 1_048_576;

const callMs = 2500;

const stopped: unknown = expect.stringMatching(
  /\]\n(?:It took longer to read than the \d\.\d s the call had left|It took more memory to read than a process that reads a document may take), so its reading was stopped$|\]\nThe call ended before it was read$/u,
);

function recordedReading(reading: DocumentReading): {
  readonly documents: DocumentReading;
  readonly bounds: readonly ReadingBounds[];
} {
  const bounds: ReadingBounds[] = [];
  return {
    documents: (given, bounded) => {
      bounds.push(bounded);
      return reading(given, bounded);
    },
    bounds,
  };
}

/**
 * A clock that reads a whole call ahead each time it is read, so that a reading starts with nothing of its call left,
 * whichever of two calls at once reads it, until it stands still, when a call has all of its time.
 */
function readingAhead() {
  const clock = { at: 0, ahead: true };
  return {
    now: () => (clock.ahead ? (clock.at += callMs) : clock.at),
    standStill: () => Object.assign(clock, { ahead: false }),
  };
}

async function pooledAccess(callMsOfTheTest = callMs, now?: () => number) {
  const pool = processPool({ processes: 2, longJobs: 1, memoryBytes: 768 * mebibyte, path: process.env['PATH'] });
  closedAfter(() => pool.close());
  const fake = fakeApi();
  const { documents, bounds } = recordedReading(documentsReadIn(pool));
  const reporting = await describedAccess(
    { graph: { org: 'acme', ...keyed(fake) } },
    {
      environment: { GRAPH_API_KEY: apiKey },
      timing: { callMs: callMsOfTheTest, openMs: 20_000, longestRetryWaitMs: 1000 },
      documents,
      ...(now === undefined ? {} : { now }),
    },
  );
  closedAfter(reporting.access.close);
  return { access: reporting.access, bounds };
}

function boundOf({ deadlineMs, signal }: ReadingBounds) {
  return { atMostTheCall: deadlineMs <= callMs, endingWithTheCall: signal !== undefined };
}

describe('a file a tool of an HTTP API fetches, read in a process of the pool', () => {
  it('answers its text', async () => {
    const { access } = await pooledAccess(20_000);

    expect(await called(access, 'file', { fileName: 'terms.txt' })).toMatchObject({
      outcome: 'result',
      answer: {
        content: [
          { text: '[The file terms.txt, text/plain, 49 bytes]\nSupplier terms\nReturns are taken within 14 days.\n' },
        ],
      },
    });
  });

  it('stops a PDF that draws its drawings within one another, and a Word document that unpacks to far more, within what the call has left, answering in words', async () => {
    const clock = readingAhead();
    const { access, bounds } = await pooledAccess(callMs, clock.now);

    const answers = await Promise.all([
      called(access, 'file', { fileName: 'nested.pdf' }),
      called(access, 'file', { fileName: 'unpacking.docx' }),
    ]);
    const boundsOfTheReadings = bounds.map((bounded) => boundOf(bounded));
    clock.standStill();
    const next = await called(access, 'file', { fileName: 'terms.txt' });

    expect(answers).toMatchObject([
      { outcome: 'result', answer: { content: [{ text: stopped }] } },
      { outcome: 'result', answer: { content: [{ text: stopped }] } },
    ]);
    expect(boundsOfTheReadings).toEqual([
      { atMostTheCall: true, endingWithTheCall: true },
      { atMostTheCall: true, endingWithTheCall: true },
    ]);
    expect(next).toMatchObject({ outcome: 'result' });
  });
});

const settings: DescribedApiSettings = {
  type: 'openapi',
  name: 'graph',
  document: { kind: 'url', url: 'https://graph.example.com/openapi.json' },
  base_url: null,
  headers: new Map(),
  query_params: new Map(),
  security: new Map(),
  path_values: new Map(),
  auth: null,
  failure_codes: null,
  orgs: ['acme'],
  playbooks: null,
  allowed: null,
  marks: { reads: [], acts: [] },
  record_content: true,
  request_id: null,
  secrets: [],
  connection: null,
  provider: null,
  api: {
    baseUrl: 'https://graph.example.com/v1',
    operations: [
      {
        tool: { name: 'file', inputSchema: {} },
        method: 'get',
        path: '/files/terms',
        inputs: [],
        body: null,
        credentials: [],
        answers: { schemas: [], components: {}, headers: {}, describesNoBody: false },
      },
    ],
  },
};

describe('the time a file an answer carries is read within', () => {
  it('is what the call has left, on the clock the client is given, when its reading starts', async () => {
    const clock = { at: 1000 };
    const deadlines: number[] = [];
    const client = apiClient(settings, {
      fetch: () => {
        clock.at += 700;
        return Promise.resolve(
          new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'content-type': 'application/pdf' } }),
        );
      },
      tokens: undefined,
      now: () => clock.at,
      documents: (_given, { deadlineMs }) => {
        deadlines.push(deadlineMs);
        return Promise.resolve({ read: false, because: 'not read', mediaType: 'application/pdf' });
      },
    });

    await client.call({ tool: 'file', input: {}, meta: {}, signal: new AbortController().signal, timeoutMs: 2500 });

    expect(deadlines).toEqual([1800]);
  });
});

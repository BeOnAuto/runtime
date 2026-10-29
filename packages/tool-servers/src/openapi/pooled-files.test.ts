import { documentsReadIn } from '@on.auto/documents';
import { processPool } from '@on.auto/workflow-engine/dsl';
import { describe, expect, it } from 'vitest';

import { apiKey, called, closedAfter, fakeApi, keyed } from '../api-testing/api-calls.ts';
import { describedAccess } from '../testing/reporting-access.ts';

const mebibyte = 1_048_576;

const callMs = 2500;

const stopped: unknown = expect.stringMatching(
  /\]\n(?:It took longer to read than the \d\.\d s the call had left|It took more memory to read than a process that reads a document may take), so its reading was stopped$|\]\nThe call ended before it was read$/u,
);

async function pooledAccess(callMsOfTheTest = callMs) {
  const pool = processPool({ processes: 2, longJobs: 1, memoryBytes: 768 * mebibyte, path: process.env['PATH'] });
  closedAfter(() => pool.close());
  const fake = await fakeApi();
  const reporting = await describedAccess(
    { graph: { org: 'acme', ...keyed(fake) } },
    {
      environment: { GRAPH_API_KEY: apiKey },
      timing: { callMs: callMsOfTheTest, openMs: 20_000, longestRetryWaitMs: 1000 },
      documents: documentsReadIn(pool),
    },
  );
  closedAfter(reporting.access.close);
  return reporting.access;
}

describe('a file a tool of an HTTP API fetches, read in a process of the pool', () => {
  it('answers its text', async () => {
    const access = await pooledAccess(20_000);

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
    const access = await pooledAccess();
    const started = performance.now();

    const answers = await Promise.all([
      called(access, 'file', { fileName: 'nested.pdf' }),
      called(access, 'file', { fileName: 'unpacking.docx' }),
    ]);
    const took = performance.now() - started;
    const next = await called(access, 'file', { fileName: 'terms.txt' });

    expect(answers).toMatchObject([
      { outcome: 'result', answer: { content: [{ text: stopped }] } },
      { outcome: 'result', answer: { content: [{ text: stopped }] } },
    ]);
    expect(took).toBeLessThan(callMs + 3000);
    expect(next).toMatchObject({ outcome: 'result' });
  });
});

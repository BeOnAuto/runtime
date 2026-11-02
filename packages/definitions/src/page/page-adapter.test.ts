import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunContext } from '../capability/run-context.ts';
import { recordingJournal } from '../journal-testing/recording-journal.ts';
import { noCalledDefinitions } from '../testing/called-definitions.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { checkingNothing, keepingNoViews } from '../testing/page-ports.ts';
import { pageOf } from '../testing/pages.ts';
import { makePageAdapter, pageNeverRuns } from './page-adapter.ts';

const pages = makePageAdapter({ pool: checkingNothing, views: keepingNoViews });

const askedToRun: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  playbook: 'alpha',
  caller: acmeAdmin,
  definition: { name: 'morning-posts', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
};

describe('the page adapter', () => {
  it('refuses a run even when asked directly, and has no output to describe', async () => {
    const prepared = await Effect.runPromise(pages.prepare(pageOf()));

    expect(await Effect.runPromise(Effect.flip(prepared.run({}, askedToRun)))).toMatchObject({
      detail: pageNeverRuns,
    });
    expect(pages.describeOutput(null)).toBe('A page never runs, so it has no output.');
  });

  it('finds the line of the subject in a page it reads, and the first line in one it cannot', () => {
    expect([pages.presents?.subjectLineOf(pageOf()), pages.presents?.subjectLineOf('Not a page')]).toEqual([2, 1]);
  });
});

import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeptViews } from '../capability/view-standing.ts';
import type { RunDetailAsRecorded } from '../runs/run.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { textKeptIn } from '../testing/kept-documents.ts';
import { watchedStore } from '../testing/kept-payloads.ts';
import { playbookAsked } from '../testing/page-asking.ts';
import { workflowWithData } from '../testing/pages.ts';
import { subjectPagesOf } from './subject-pages.ts';

const keepingNoViews: KeptViews = {
  viewOf: () => Effect.undefined,
  newestRecordAt: () => Effect.undefined,
  viewAsOfRun: () => Effect.undefined,
};

const pages = subjectPagesOf({
  pool: {
    check: () => Promise.resolve({ ran: 'checked', issues: [], stripped: { expressions: [] }, milliseconds: 0 }),
  },
  views: keepingNoViews,
});

const source = `# ${'A morning that is written at length. '.repeat(60)}\n${workflowWithData()}`;

const morning = { type: 'workflow', name: 'morning' };

const pastTheHour = '2026-10-01T11:00:00.000Z';

const alpha = { org: 'acme', playbook: 'alpha' };

function ranWith(date: Schema.Json): RunDetailAsRecorded {
  return {
    run_id: '0199a3c4-0000-7000-8000-000000000001',
    type: 'workflow',
    name: 'morning',
    definition_version: 1,
    status: 'succeeded',
    output: { inline: { date } },
    started_at: '2026-11-01T08:00:00.000Z',
    started_by: recordedAdmin,
    finished_at: '2026-11-01T08:01:00.000Z',
  };
}

async function morningKeptOutside() {
  const watched = watchedStore();
  const asked = playbookAsked(watched.store);
  const page = await Effect.runPromise(pages.check(source, 'workflow'));
  const kept = await asked.playbook.run(textKeptIn(asked.playbook.ledger.service.content, alpha, source));
  const texts = { source_sha256: kept.sha256, source_bytes: kept.bytes };
  await asked.record('workflow', {
    type: 'create',
    name: 'morning',
    content: { ...texts, ...(page === undefined ? {} : { page }) },
    created_by: recordedAdmin,
    definition_id: 'id-of-it',
  });
  return { asked, watched };
}

const sizeOfTheDocument = new TextEncoder().encode(source).byteLength.toLocaleString('en-US');

describe('the page of a definition whose document its playbook keeps outside its fact', () => {
  it('renders from the document it reads from the store, once for each render', async () => {
    const { asked, watched } = await morningKeptOutside();

    expect(await asked.ask(pages.resultOf('workflow', 'morning', { run: ranWith('2026-11-01') }))).toMatchObject({
      output: { answer: '2026-11-01' },
    });
    expect(watched.reads()).toBe(1);
  });

  it('says, where its document would render, why it cannot be shown while the document is gone', async () => {
    const { asked, watched } = await morningKeptOutside();
    watched.lose();
    const words = `The page of workflow/morning could not be shown: its document, ${sizeOfTheDocument} bytes, is missing from the playbook's content.`;

    expect([
      await asked.ask(pages.resultOf('workflow', 'morning', { run: ranWith('2026-11-01') }), pastTheHour),
      await asked.ask(pages.viewsOf(morning), pastTheHour),
      await asked.ask(pages.asOfRun(morning, 'a-run'), pastTheHour),
    ]).toMatchObject([
      { output: { answer: words } },
      { output: { answer: { runs: words } } },
      { output: { answer: { runs: words } } },
    ]);
  });

  it('says so too while the document cannot be read just now, and shows it once it can', async () => {
    const { asked, watched } = await morningKeptOutside();
    watched.fail();

    expect(await asked.ask(pages.resultOf('workflow', 'morning', { run: ranWith('2026-11-01') }))).toMatchObject({
      output: {
        answer: `The page of workflow/morning could not be shown: its document, ${sizeOfTheDocument} bytes, could not be read just now; it shows here once it can be read.`,
      },
    });
  });
});

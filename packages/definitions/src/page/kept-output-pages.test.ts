import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeptViews } from '../capability/view-standing.ts';
import type { RunDetailAsRecorded } from '../runs/run.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { keptArmOf, keptIn, keptLongBeforeAndLost, recordedAsGiven, watchedStore } from '../testing/kept-payloads.ts';
import { playbookAsked } from '../testing/page-asking.ts';
import { resultOfTheDay, workflowWithPage } from '../testing/pages.ts';
import { latestEndedRunOf, latestRunOf } from './preview-runs.ts';
import { subjectPagesOf, type PageContent } from './subject-pages.ts';

const nothingKept: KeptViews = {
  viewOf: () => Effect.undefined,
  newestRecordAt: () => Effect.undefined,
  viewAsOfRun: () => Effect.undefined,
};

const checkedAsWritten = {
  check: () =>
    Promise.resolve({
      ran: 'checked' as const,
      issues: [],
      stripped: { module: '', expressions: [] },
      milliseconds: 0,
    }),
};

const pages = subjectPagesOf({ pool: checkedAsWritten, views: nothingKept });

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-0000-7000-8000-0000000000a1';

const output = { date: '2026-11-01', letter: 'l'.repeat(4096) };

const kept = keptArmOf(output);

const ran: RunDetailAsRecorded = {
  run_id: runId,
  type: 'workflow',
  name: 'morning-social-content',
  definition_version: 1,
  status: 'succeeded',
  output: { kept },
  started_at: '2026-11-01T08:00:00.000Z',
  started_by: recordedAdmin,
  finished_at: '2026-11-01T08:01:00.000Z',
};

const onTheRun = {
  runId,
  by: 'acme-admin',
  at: '2026-11-01T08:00:00.000Z',
  definitionType: 'workflow',
  definitionName: 'morning-social-content',
  definitionVersion: 1,
};

async function contentOf(source: string): Promise<PageContent> {
  const content = await Effect.runPromise(pages.check(source, 'workflow'));
  if (content === null || content === undefined) {
    throw new Error('The source has no page');
  }
  return content;
}

const namingTheOutput = workflowWithPage({ result: resultOfTheDay });

const namingNoOutput = workflowWithPage({ result: 'Version {{ run.version }}' });

async function withTheMorning(source: string, held: boolean) {
  const watched = watchedStore();
  const asked = playbookAsked(watched.store);
  await asked.created('workflow', 'morning-social-content', source, { page: await contentOf(source) });
  const { service } = asked.playbook.ledger;
  await Effect.runPromise(
    Effect.all([
      held
        ? keptIn(service.content, alpha, output)
        : keptLongBeforeAndLost(service.content, watched.store, alpha, output),
      recordedAsGiven(
        service,
        `playbook/acme/alpha/runs/${runId}`,
        [
          { type: 'run_started', data: { input: {}, started_by: recordedAdmin } },
          { type: 'run_succeeded', data: { output_sha256: kept.sha256, output_bytes: kept.bytes, record: {} } },
        ],
        onTheRun,
      ),
    ]),
  );
  return { ...asked, watched };
}

const resultOver = (over: Parameters<typeof pages.resultOf>[2]) =>
  pages.resultOf('workflow', 'morning-social-content', over);

describe('the result of a run whose output its playbook keeps outside the run, on its page', () => {
  it('renders the output read once, over a run or as the latest run, where the result names it', async () => {
    const asked = await withTheMorning(namingTheOutput, true);

    expect(await asked.ask(resultOver({ run: ran }))).toMatchObject({ output: { answer: '2026-11-01' } });
    expect(await asked.ask(resultOver({ latest: true }))).toMatchObject({ output: { answer: '2026-11-01' } });
    expect(asked.watched.reads()).toBe(2);
  });

  it('reads nothing where the result names no output, or where the read is given', async () => {
    const asked = await withTheMorning(namingNoOutput, true);
    const naming = await withTheMorning(namingTheOutput, true);

    expect(await asked.ask(resultOver({ run: ran }))).toMatchObject({ output: { answer: 'Version 1' } });
    expect(await naming.ask(resultOver({ run: ran, read: { read: output } }))).toMatchObject({
      output: { answer: '2026-11-01' },
    });
    expect([asked.watched.reads(), naming.watched.reads()]).toEqual([0, 0]);
  });

  it('shows the size of an output that could not be read, and why, and the page answers all the same', async () => {
    const unreachable = await withTheMorning(namingTheOutput, true);
    unreachable.watched.fail();
    const missing = await withTheMorning(namingTheOutput, false);
    const erased = { unread: 'erased', kept } as const;

    expect([
      await unreachable.ask(resultOver({ run: ran })),
      await missing.ask(resultOver({ run: ran })),
      await missing.ask(resultOver({ run: ran, read: erased })),
    ]).toMatchObject([
      {
        output: {
          answer: `The result of this run, ${kept.bytes.toLocaleString('en-US')} bytes, could not be read just now; it shows here once it can be read.`,
        },
      },
      {
        output: {
          answer: `The result of this run, ${kept.bytes.toLocaleString('en-US')} bytes, is missing from the playbook's content.`,
        },
      },
      { output: { answer: `The result of this run, ${kept.bytes.toLocaleString('en-US')} bytes, was erased.` } },
    ]);
  });
});

describe('the latest run of a definition, as a preview or a glance reads it', () => {
  it('reads its output where its template names it, and nothing where it does not', async () => {
    const asked = await withTheMorning(namingTheOutput, true);
    const times = { started: ran.started_at, ended: ran.started_at, version: 1 };

    expect(await asked.ask(latestRunOf('workflow', 'morning-social-content', false))).toMatchObject({
      output: { answer: { status: 'succeeded', output: null, ...times } },
    });
    expect(asked.watched.reads()).toBe(0);
    expect(await asked.ask(latestEndedRunOf('workflow', 'morning-social-content', true))).toMatchObject({
      output: { answer: { status: 'succeeded', output, ...times } },
    });
    expect(asked.watched.reads()).toBe(1);
  });
});

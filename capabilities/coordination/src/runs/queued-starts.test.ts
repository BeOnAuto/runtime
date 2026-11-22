import { cursorOfParts, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { mostOutcomeCharacters } from '@on.auto/phrasing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { namingLedger, playbookOn } from '../testing/playbook.ts';
import { recordingStarts, recordingWorkflows } from '../testing/recording-starts.ts';
import { acmeCaller, runId } from '../testing/workflows.ts';
import { defineListQueuedStarts } from './queued-starts.ts';

type QueuedReads = Parameters<typeof recordingWorkflows>[1] & Parameters<typeof defineListQueuedStarts>[0];

type QueuedPage = Effect.Success<ReturnType<QueuedReads['queuedStartsPage']>>;

type QueuedAsked = Parameters<QueuedReads['queuedStartsPage']>;

const flow = "document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: []\n";

const minute = Date.parse('2026-10-01T09:00:00.000Z');

const aMinute = 60_000;

const event = {
  id: 'event-1',
  type: 'com.acme.ledger.month-closed',
  source: '/ledger/eu',
  subject: 'october',
  time: '2026-10-01T08:59:30Z',
};

function queueHolding(page: QueuedPage) {
  const asked: (Readonly<QueuedAsked> | readonly [QueuedAsked[0]])[] = [];
  const queued: QueuedReads = {
    queuedStartsOf: (workflow) =>
      Effect.sync(() => {
        asked.push([workflow]);
        return { queued: page.starts.length, nextDueAt: page.starts.at(0)?.dueAt ?? null };
      }),
    queuedStartsPage: (workflow, pageAsked) =>
      Effect.sync(() => {
        asked.push([workflow, pageAsked]);
        return page;
      }),
  };
  return { asked, queued };
}

async function playbookQueuing(page: QueuedPage) {
  const { asked, queued } = queueHolding(page);
  const playbook = playbookOn(namingLedger(), [recordingWorkflows(recordingStarts().recording, queued)]);
  const created = await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'flow', source: flow });
  const askedAtTheSave = asked.splice(0);
  return { ...playbook, asked, askedAtTheSave, created, listQueuedStarts: defineListQueuedStarts(queued) };
}

function idOf(created: Outcome): unknown {
  return created.status === 'succeeded' ? created.output['definition_id'] : undefined;
}

function nextCursorOf(page: Outcome): unknown {
  return page.status === 'succeeded' ? page.output['next_cursor'] : undefined;
}

function aStart(index: number, dueAt: number) {
  return { runId: `run-${index}`, event, dueAt, attempts: index % 2 };
}

const twoQueued: QueuedPage = { starts: [aStart(1, minute + aMinute), aStart(2, minute + 2 * aMinute)], more: true };

describe('a workflow read with get_definition', () => {
  it('stands with how many of its runs are queued to start and when the first is due, asked of its own id, as its save answered', async () => {
    const playbook = await playbookQueuing(twoQueued);

    const read = await playbook.call(playbook.getDefinition, { type: 'workflow', name: 'flow' });

    const standing = { queued: 2, next_queued_start: '2026-10-01T09:01:00.000Z' };
    expect(read).toMatchObject({ status: 'succeeded', output: { standing } });
    expect(playbook.created).toMatchObject({ status: 'succeeded', output: { standing } });
    const ofItsOwnId = [{ org: 'acme', definition: idOf(playbook.created) }];
    expect([playbook.askedAtTheSave, playbook.asked]).toEqual([[ofItsOwnId], [ofItsOwnId]]);
  });

  it('stands with none queued and no time when nothing waits', async () => {
    const playbook = playbookOn(namingLedger(), [recordingWorkflows(recordingStarts().recording)]);
    await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'flow', source: flow });

    expect(await playbook.call(playbook.getDefinition, { type: 'workflow', name: 'flow' })).toMatchObject({
      output: { standing: { queued: 0, next_queued_start: null } },
    });
  });
});

describe('list_queued_starts', () => {
  it('lists the page the host reads for the workflow named, its times in ISO 8601 and a cursor to read on after it', async () => {
    const playbook = await playbookQueuing(twoQueued);

    const first = await playbook.call(playbook.listQueuedStarts, { workflow: 'flow', limit: 2 });
    await playbook.call(playbook.listQueuedStarts, { workflow: 'flow', cursor: nextCursorOf(first) });

    expect(first).toEqual({
      status: 'succeeded',
      output: {
        status: 'active',
        queued_starts: [
          { run_id: 'run-1', event, due: '2026-10-01T09:01:00.000Z', attempts: 1 },
          { run_id: 'run-2', event, due: '2026-10-01T09:02:00.000Z', attempts: 0 },
        ],
        has_more: true,
        next_cursor: cursorOfParts([minute + 2 * aMinute, 'run-2']),
      },
    });
    expect(playbook.asked.map(([, asked]) => asked)).toEqual([
      { limit: 2 },
      { after: { dueAt: minute + 2 * aMinute, runId: 'run-2' }, limit: 20 },
    ]);
  });

  it('answers no cursor on the last page', async () => {
    const playbook = await playbookQueuing({ starts: [aStart(3, minute + aMinute)], more: false });

    expect(await playbook.call(playbook.listQueuedStarts, { workflow: 'flow' })).toMatchObject({
      output: { has_more: false, next_cursor: null },
    });
  });

  it('is refused for a workflow the playbook does not have, and for a cursor it did not give', async () => {
    const playbook = await playbookQueuing(twoQueued);

    const unknown = await playbook.call(playbook.listQueuedStarts, { workflow: 'another' });
    const badCursor = await playbook.call(playbook.listQueuedStarts, {
      workflow: 'flow',
      cursor: cursorOfParts(['run-2']),
    });

    expect([unknown, badCursor]).toMatchObject([
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/cursor' }] },
    ]);
    expect(playbook.asked).toEqual([]);
  });
});

describe('the status list_queued_starts answers with a page', () => {
  it('is the status of the workflow, paused once the workflow is paused', async () => {
    const playbook = await playbookQueuing(twoQueued);

    const inUse = await playbook.call(playbook.listQueuedStarts, { workflow: 'flow' });
    await playbook.call(playbook.pauseDefinition, { type: 'workflow', name: 'flow' });
    const paused = await playbook.call(playbook.listQueuedStarts, { workflow: 'flow' });

    expect([inUse, paused]).toMatchObject([{ output: { status: 'active' } }, { output: { status: 'paused' } }]);
  });
});

const shownStart = { run_id: 'run-1', event: { ...event }, due: '2026-10-01T09:01:00.000Z', attempts: 0 } as const;

type WorkflowStatus = 'active' | 'paused';

interface ShownPage {
  readonly status: WorkflowStatus;
  readonly queued_starts: readonly (typeof shownStart)[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}

function pageOf(status: WorkflowStatus, starts: number, more: boolean): ShownPage {
  return {
    status,
    queued_starts: Array.from({ length: starts }, () => shownStart),
    has_more: more,
    next_cursor: more ? 'next' : null,
  };
}

const listingPages: readonly (readonly [number, boolean])[] = [
  [1, false],
  [1, true],
  [2, false],
  [2, true],
];

function wordsOf(page: ShownPage, cursor?: string): string {
  const { plainLanguage } = defineListQueuedStarts(queueHolding(twoQueued).queued).registration;
  return plainLanguage?.outcome(page, cursor === undefined ? { workflow: 'flow' } : { workflow: 'flow', cursor }) ?? '';
}

function addedWhenPaused(starts: number, more: boolean): string {
  const inUse = wordsOf(pageOf('active', starts, more));
  const paused = wordsOf(pageOf('paused', starts, more));
  return paused.startsWith(inUse) ? paused.slice(inUse.length) : '';
}

function wordsOfListQueuedStarts(): readonly string[] {
  const { plainLanguage } = defineListQueuedStarts(queueHolding(twoQueued).queued).registration;
  const statuses: readonly WorkflowStatus[] = ['active', 'paused'];
  return [
    wordsOf(pageOf('active', 0, false)),
    wordsOf(pageOf('active', 0, false), 'after'),
    ...statuses.flatMap((status) => listingPages.map(([starts, more]) => wordsOf(pageOf(status, starts, more)))),
    plainLanguage?.attempt({ workflow: 'flow' }) ?? '',
    plainLanguage?.attempt({}) ?? '',
  ];
}

function outsideTheOutcomeBound(said: string): boolean {
  return said.length === 0 || said.length > mostOutcomeCharacters;
}

describe('the words of list_queued_starts', () => {
  it('say each page apart, for a workflow in use and a paused one, and what it tried, within the bound of an outcome', () => {
    const words = wordsOfListQueuedStarts();

    expect(new Set(words).size).toBe(words.length);
    expect(words.filter((said) => outsideTheOutcomeBound(said))).toEqual([]);
  });

  it('say of a paused workflow one way where its one run is the last of the list and another where several follow', () => {
    const [lastOne, oneWithMore, several, severalWithMore] = listingPages.map(([starts, more]) =>
      addedWhenPaused(starts, more),
    );

    expect(lastOne).not.toBe('');
    expect([oneWithMore, several, severalWithMore]).toEqual([several, several, several]);
    expect(lastOne).not.toBe(several);
  });

  it('say the same of a paused workflow as of one in use where no run is listed', () => {
    expect([wordsOf(pageOf('paused', 0, false)), wordsOf(pageOf('paused', 0, false), 'after')]).toEqual([
      wordsOf(pageOf('active', 0, false)),
      wordsOf(pageOf('active', 0, false), 'after'),
    ]);
  });
});

describe('who may list the queued starts of a workflow', () => {
  it('is whoever may read the runs of the playbook: anyone else is refused, as get_run refuses them', async () => {
    const playbook = await playbookQueuing(twoQueued);
    const writing: CallerIdentity = { ...acmeCaller, permissions: ['playbook:write'] };
    const elsewhere: CallerIdentity = { ...acmeCaller, playbooks: ['beta'] };

    const refused = await Promise.all(
      [writing, elsewhere].flatMap((caller) => [
        playbook.call(playbook.listQueuedStarts, { workflow: 'flow' }, caller),
        playbook.call(playbook.getRun, { run_id: runId }, caller),
      ]),
    );

    expect(refused).toMatchObject([
      { status: 'rejected', reason: 'forbidden' },
      { status: 'rejected', reason: 'forbidden' },
      { status: 'rejected', reason: 'forbidden' },
      { status: 'rejected', reason: 'forbidden' },
    ]);
    expect(playbook.asked).toEqual([]);
  });
});

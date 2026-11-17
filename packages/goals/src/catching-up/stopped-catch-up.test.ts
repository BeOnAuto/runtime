import type { DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { deliveredAll, finished, monday, type Book } from '../assessor/assessor-ledger.ts';
import { hour, inboxBook, logged, onEvent, orderId, type Inbox } from '../assessor/inbox-samples.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { stoppedCatchUpOf } from './stopped-catch-up.ts';

const later = monday + 20 * hour;

const words = 'No decision within 20 hours, so no reply was sent.';

const inbox: Inbox = {
  emails: [
    ['juniper', monday - 1000],
    ['harbor', monday - 1000],
  ],
  runs: [
    ['run-log-1', 'juniper', monday - 900],
    ['run-log-2', 'harbor', monday - 900],
    ['run-decide-1', 'juniper', monday - 900],
    ['run-decide-2', 'harbor', monday - 900],
  ],
};

interface Ended {
  readonly run: string;
  readonly type: string;
  readonly at: number;
}

function endedBefore(book: Book, { run, type, at }: Ended) {
  return book.append(
    `runs/${run}`,
    type,
    type === 'run_rejected' ? { rejection: { reason: 'unavailable', detail: words } } : {},
    {
      at: new Date(at).toISOString(),
      by: 'playbook:sales',
      runId: run,
      definitionType: 'workflow',
      definitionName: 'decide-order',
      definitionVersion: 1,
      ...onEvent,
    },
  );
}

async function performedOnce(work: DueWork): Promise<readonly string[]> {
  const items = await Effect.runPromise(work.due(later, 10, false));
  await Effect.runPromise(Effect.forEach(items, (item) => item.perform(later), { discard: true }));
  return items.map(({ key }) => key);
}

async function aStoreRecordedBefore() {
  const built = await inboxBook(inbox);
  await deliveredAll(built.assessor, logged('log-1', 'ORD-1'));
  await deliveredAll(built.assessor, logged('log-2', 'ORD-2'));
  await endedBefore(built.book, { run: 'run-decide-1', type: 'run_rejected', at: later });
  return built;
}

describe('a store whose follower passed a failed run before this release judged it by the email it shares', () => {
  it('shows the thing stopped once its host has opened, with the run’s words, and writes nothing more on a later open', async () => {
    const { book, ports } = await aStoreRecordedBefore();

    const first = stoppedCatchUpOf(ports);
    const handed = await performedOnce(first);
    const again = await performedOnce(first);
    await performedOnce(stoppedCatchUpOf(ports));
    const rows = await book.rows(assessmentsName);

    expect([handed, again]).toEqual([['acme/sales/the stopped things of the goals caught up'], []]);
    expect(rows[orderId('ORD-1')]).toMatchObject({ open: true, verdict: 'open', stopped_run: 'run-decide-1' });
    expect(String(rows[orderId('ORD-1')]?.['state'])).toContain(words);
    expect(rows[orderId('ORD-2')]).toMatchObject({ stopped_at: null });
    expect(await book.factsOf(`assessments/${orderId('ORD-1')}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_stopped',
    ]);
  });

  it('leaves a thing marked again after its run failed, and passes over failures from before its oldest mark or of no named workflow', async () => {
    const { book, ports, assessor } = await aStoreRecordedBefore();
    await endedBefore(book, { run: 'run-decide-2', type: 'run_failed', at: monday - hour });
    await book.append(
      'runs/run-unnamed',
      'run_failed',
      {},
      {
        at: new Date(later).toISOString(),
        runId: 'run-unnamed',
        definitionType: 'workflow',
      },
    );
    await deliveredAll(
      assessor,
      finished({ id: 'price-1', workflow: 'price-order', at: later + hour, data: { output: { id: 'ORD-1' } } }),
    );

    await performedOnce(stoppedCatchUpOf(ports));
    const rows = await book.rows(assessmentsName);

    expect([rows[orderId('ORD-1')]?.['stopped_at'], rows[orderId('ORD-2')]?.['stopped_at']]).toEqual([null, null]);
  });
});

describe('the catching up of stopped things', () => {
  it('has nothing to do in a playbook with no open thing, or where every open thing is stopped', async () => {
    const empty = await inboxBook(inbox);
    const { book, ports, assessor } = await inboxBook(inbox);
    await deliveredAll(assessor, logged('log-1', 'ORD-1'));
    await endedBefore(book, { run: 'run-decide-1', type: 'run_rejected', at: later });
    const stopping = stoppedCatchUpOf(ports);
    await performedOnce(stopping);

    expect(await performedOnce(stoppedCatchUpOf(empty.ports))).toEqual([]);
    expect(await performedOnce(stoppedCatchUpOf(ports))).toEqual([
      'acme/sales/the stopped things of the goals caught up',
    ]);
    expect(await book.factsOf(`assessments/${orderId('ORD-1')}`)).toHaveLength(3);
    expect(await Effect.runPromise(stopping.due(later, 10, true))).toEqual([]);
    expect(await Effect.runPromise(stopping.nextDueAt(later))).toBeNull();
  });
});

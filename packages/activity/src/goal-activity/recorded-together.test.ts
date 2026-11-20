import { leadGoalId, plainGoalId } from '@on.auto/playbooks/testing';
import { describe, expect, it } from 'vitest';

import { assessed, assessments, at, goalsHeld, goalsOfFinance, opened, projections } from '../testing/goal-activity.ts';
import { activityHarness, ada, listedOf, outputOf, priya } from '../testing/harness.ts';
import type { RecordedFact } from '../testing/recorded-facts.ts';
import { activityOperationsKeepingGoals } from './goal-operations.ts';

const midday = '1a2b3c4d-5e6f-5a7b-8c9d-0e1f2a3b4c5d';

const evening = '2b3c4d5e-6f7a-5b8c-9d0e-1f2a3b4c5d6e';

const morning = '3c4d5e6f-7a8b-5c9d-8e0f-2a3b4c5d6e7f';

const elsewhere = '4d5e6f7a-8b9c-5d0e-9f1a-3b4c5d6e7f8a';

const caughtUp = '15:42';

const judgedLate = (verdict: string, names: string): RecordedFact => ({
  ...assessed(verdict, 'now', caughtUp),
  data: { verdict, at: at(names), by: 'final', told: 'now' },
});

interface Judged {
  readonly playbook: string;
  readonly id: string;
  readonly names: string;
}

const judged: readonly Judged[] = [
  { playbook: 'finance', id: midday, names: '12:00' },
  { playbook: 'finance', id: evening, names: '14:00' },
  { playbook: 'sales', id: elsewhere, names: '13:00' },
  { playbook: 'finance', id: morning, names: '09:00' },
];

async function caughtUpTogether(inTurn: readonly Judged[]) {
  const harness = activityHarness(undefined, { ...activityOperationsKeepingGoals(goalsOfFinance), projections });
  await harness.created(priya, 'finance', at('08:00'));
  await harness.created(ada, 'sales', at('08:00'));
  await goalsHeld(harness.record);
  await inTurn.reduce(
    (before, { playbook, id, names }) =>
      before.then(() =>
        harness.record(
          assessments(playbook, playbook === 'finance' ? leadGoalId : plainGoalId, id),
          opened('08:30'),
          judgedLate('passed', names),
        ),
      ),
    Promise.resolve(),
  );
  return harness;
}

type Listing = Awaited<ReturnType<typeof caughtUpTogether>>['list'];

async function addressesPaged(list: Listing, cursor?: string): Promise<readonly string[]> {
  const asked = cursor === undefined ? { kind: 'goal', limit: '1' } : { kind: 'goal', limit: '1', cursor };
  const page = listedOf(await list(ada, asked));
  const addresses = page.rows.map(({ address }) => address);
  return page.next_cursor === null ? addresses : [...addresses, ...(await addressesPaged(list, page.next_cursor))];
}

interface Listed {
  readonly address: string;
  readonly at: string;
  readonly result_at: string;
}

const newestResultFirst: readonly Listed[] = [
  { address: `finance/assessments/${evening}`, at: at(caughtUp), result_at: at('14:00') },
  { address: `sales/assessments/${elsewhere}`, at: at(caughtUp), result_at: at('13:00') },
  { address: `finance/assessments/${midday}`, at: at(caughtUp), result_at: at('12:00') },
  { address: `finance/assessments/${morning}`, at: at(caughtUp), result_at: at('09:00') },
];

const ofVerdicts = { kind: 'goal' };

describe('verdicts recorded in the same instant where goals are kept', () => {
  it('are listed by the time each verdict names, the latest first, and each row carries that time beside when it was recorded', async () => {
    const { list } = await caughtUpTogether(judged);

    expect(outputOf(await list(ada, ofVerdicts))).toMatchObject({
      rows: newestResultFirst,
      counts: { goals: 4 },
    });
  });

  it('are listed in that order on every read, and from facts recorded in any other order', async () => {
    const { list } = await caughtUpTogether(judged);
    const again = await caughtUpTogether(judged.toReversed());

    const first = listedOf(await list(ada, ofVerdicts)).rows;
    expect(listedOf(await list(ada, ofVerdicts)).rows).toEqual(first);
    expect(listedOf(await again.list(ada, ofVerdicts)).rows).toEqual(first);
  });

  it('are read one a page in that order through the cursors, each once, and after the newest by since', async () => {
    const { list } = await caughtUpTogether(judged);
    const pages = await addressesPaged(list);
    const [, second] = listedOf(await list(ada, ofVerdicts)).rows;

    expect(pages).toEqual(newestResultFirst.map(({ address }) => address));
    expect(listedOf(await list(ada, { ...ofVerdicts, since: String(second?.cursor) })).rows).toMatchObject([
      { address: newestResultFirst[0]?.address },
    ]);
  });
});

describe('the marks of verdicts recorded in the same instant where goals are kept', () => {
  it('are marked seen through the newest of them, and one by its address and at, and stay unseen otherwise', async () => {
    const harness = await caughtUpTogether(judged);
    const [newest] = listedOf(await harness.list(ada, ofVerdicts)).rows;
    const one = await harness.mark(ada, { items: [{ address: `finance/assessments/${midday}`, at: at(caughtUp) }] });
    const all = await harness.mark(ada, { through: String(newest?.cursor) });

    expect(outputOf(one)).toMatchObject({ counts: { goals: 3 } });
    expect(outputOf(all)).toMatchObject({ counts: { goals: 0 } });
    expect(listedOf(await harness.list(ada, ofVerdicts)).rows.map(({ seen }) => seen)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});

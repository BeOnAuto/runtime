import { streamPrefixOfDefinition, type ProjectedKeyedRow } from '@on.auto/operations';
import { leadGoalId } from '@on.auto/playbooks/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { requestsName } from '../projections/request-rows.ts';
import { at, goalsOfFinance, overdueHere, projections } from '../testing/goal-activity.ts';
import { activityHarness, ada, localDeveloper, listedOf, outputOf, priya } from '../testing/harness.ts';
import { definitionCreated, requestAnswered, runDeferred, type RunOf } from '../testing/recorded-facts.ts';
import { activityOperationsKeepingGoals } from './goal-operations.ts';
import type { StandingSetAside } from './goal-set-aside.ts';

const runOf = (index: number): RunOf => ({
  runId: `019a5000-0000-7000-8000-${String(index).padStart(12, '0')}`,
  type: 'interaction',
  name: 'approve-payment',
  version: 1,
});

const askedAnyone = runOf(1);

const askedAda = runOf(2);

const askedDana = runOf(3);

const answered = runOf(4);

const dismissal = { goal: leadGoalId, id: overdueHere, at: at('13:00'), by: priya.id };

function standingOver(runs: readonly RunOf[]): StandingSetAside {
  return ({ read }) =>
    Effect.map(
      Effect.forEach(runs, ({ runId }) =>
        read(requestsName, { where: [{ column: 'row_key', equals: runId }], orderBy: [], order: 'asc', limit: 1 }),
      ),
      (rows: readonly (readonly ProjectedKeyedRow[])[]) => new Map(rows.flat().map(({ key }) => [key, dismissal])),
    );
}

const asked = (to: string) => ({
  to,
  message: 'Approve this?',
  expiresAt: at('23:00'),
  answerSchema: { type: 'boolean' },
});

const approvePayment = { id: '019a5000-0000-7000-8000-0000000000aa', type: 'interaction', name: 'approve-payment' };

const filedUnder = streamPrefixOfDefinition({ org: 'acme', definition: approvePayment.id });

const stream = ({ runId }: RunOf) => `${filedUnder}runs/${runId}`;

async function financeAsking(setAside: readonly RunOf[]) {
  const harness = activityHarness(undefined, {
    ...activityOperationsKeepingGoals({ ...goalsOfFinance, setAside: standingOver(setAside) }),
    projections,
  });
  const { created, record } = harness;
  await created(priya, 'finance', at('09:00'));
  await created(ada, 'sales', at('09:00'));
  await record(
    `${filedUnder}definitions/interaction`,
    definitionCreated({ ...approvePayment, version: 1 }, at('09:30'), priya.id, 'finance'),
  );
  await record(stream(askedAnyone), runDeferred(askedAnyone, at('12:01'), asked('#approvals')));
  await record(stream(askedAda), runDeferred(askedAda, at('12:11'), asked(ada.id)));
  await record(stream(askedDana), runDeferred(askedDana, at('12:21'), asked('Dana@Example.com')));
  await record(
    stream(answered),
    runDeferred(answered, at('12:31'), asked('#approvals')),
    requestAnswered(answered, at('12:41'), ada.id),
  );
  return harness;
}

const needsYou = { kind: 'needs_you' };

function runsOf(outcome: Parameters<typeof outputOf>[0]): readonly string[] {
  return listedOf(outcome).rows.map(({ address }) => address);
}

const addressOf = ({ runId }: RunOf) => `finance/${runId}`;

describe('the requests a standing dismissal set aside, in list_activity where goals are kept', () => {
  it('are left out of the rows and of needs_you, and listed with their dismissal under dismissed=include, counted the same', async () => {
    const { list, mark } = await financeAsking([askedAnyone]);

    const listed = outputOf(await list(ada, needsYou));
    const included = outputOf(await list(ada, { dismissed: 'include' }));
    const [newest] = listedOf(await list(ada)).rows;
    const marked = outputOf(await mark(ada, { through: String(newest?.cursor) }));

    expect(listed).toMatchObject({
      rows: [{ address: addressOf(askedDana) }, { address: addressOf(askedAda) }],
      counts: { needs_you: 1 },
    });
    expect(JSON.stringify(listed)).not.toMatch(/dismissed/u);
    expect(included).toMatchObject({
      rows: [
        { address: addressOf(askedDana) },
        { address: addressOf(askedAda) },
        { address: addressOf(askedAnyone), dismissed: dismissal },
        { address: 'finance/definitions/interaction/approve-payment/1' },
        {},
        {},
      ],
      counts: { needs_you: 1 },
    });
    expect(JSON.stringify(included).match(/dismissed/gu)).toHaveLength(1);
    expect(marked).toMatchObject({ counts: { needs_you: 1 } });
  });

  it('counts none twice and nothing answered since, for a caller and for the local developer', async () => {
    const { list } = await financeAsking([askedAnyone, askedAda, answered]);

    expect([outputOf(await list(ada, needsYou)), outputOf(await list(localDeveloper, needsYou))]).toMatchObject([
      { rows: [{ address: addressOf(askedDana) }], counts: { needs_you: 0 } },
      { rows: [{ address: addressOf(askedDana) }], counts: { needs_you: 1 } },
    ]);
  });
});

describe('the pages and the restoring of requests a standing dismissal set aside, where goals are kept', () => {
  it('keeps each page full, reading on past the requests it leaves out', async () => {
    const { list } = await financeAsking([askedDana]);
    const first = await list(ada, { ...needsYou, limit: '1' });
    const second = await list(ada, { ...needsYou, limit: '1', cursor: String(listedOf(first).next_cursor) });

    expect([runsOf(first), listedOf(first).has_more]).toEqual([[addressOf(askedAda)], true]);
    expect([runsOf(second), listedOf(second).has_more]).toEqual([[addressOf(askedAnyone)], false]);
  });

  it('are listed and counted again once no standing dismissal sets them aside', async () => {
    const { list } = await financeAsking([]);

    expect(outputOf(await list(ada, needsYou))).toMatchObject({ rows: [{}, {}, {}], counts: { needs_you: 2 } });
  });
});

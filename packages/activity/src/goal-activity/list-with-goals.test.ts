import { leadGoalId, plainGoalId } from '@on.auto/playbooks/testing';
import { describe, expect, it } from 'vitest';

import {
  assessed,
  assessments,
  at,
  failedThere,
  failedThereRow,
  goalsKept,
  ofGoals,
  overdueHere,
  overdueHereRow,
  passedHere,
  passedHereRow,
} from '../testing/goal-activity.ts';
import { ada, listedOf, outputOf } from '../testing/harness.ts';

describe('list_activity where goals are kept', () => {
  it('lists the verdicts and the overdues the owner asked to hear of, each at its assessment, the word joined from the goals as they stand', async () => {
    const { list } = await goalsKept();

    expect(outputOf(await list(ada, ofGoals))).toMatchObject({
      rows: [failedThereRow, overdueHereRow, passedHereRow],
      has_more: false,
      next_cursor: null,
      counts: { needs_you: 0, broken: 0, new: 1, comments: 0, goals: 3 },
      through: null,
    });
  });

  it('serves every other row with the fields of goals left null, and lists the goal rows among them', async () => {
    const { list } = await goalsKept();

    expect(outputOf(await list(ada))).toMatchObject({
      rows: [
        { kind: 'goal', goal: plainGoalId },
        { kind: 'goal_overdue', goal: leadGoalId },
        { kind: 'goal', goal: leadGoalId },
        {
          kind: 'new',
          address: 'playbooks/sales/' + String(Date.parse(at('09:00'))),
          goal: null,
          outcome: null,
          word: null,
        },
        { kind: 'new', address: 'playbooks/finance/' + String(Date.parse(at('09:00'))), title: null, says: null },
      ],
    });
  });

  it('closes an overdue once its assessment is judged, and lists the verdict in its place', async () => {
    const harness = await goalsKept();
    await harness.record(assessments('finance', overdueHere), assessed('failed', 'now', '14:00'));

    expect(outputOf(await harness.list(ada, ofGoals))).toMatchObject({
      rows: [
        { kind: 'goal', address: `finance/assessments/${overdueHere}`, outcome: 'failed', word: 'Brought no customer' },
        { kind: 'goal', address: `sales/assessments/${failedThere}` },
        { kind: 'goal', address: `finance/assessments/${passedHere}` },
      ],
      counts: { goals: 3 },
    });
  });
});

describe('the pages of list_activity where goals are kept', () => {
  it('reads one goal row a page through the cursors, each row once, newest first', async () => {
    const { list } = await goalsKept();
    const first = listedOf(await list(ada, { ...ofGoals, limit: '1' }));
    const second = listedOf(await list(ada, { ...ofGoals, limit: '1', cursor: String(first.next_cursor) }));
    const third = listedOf(await list(ada, { ...ofGoals, limit: '1', cursor: String(second.next_cursor) }));

    expect([first, second, third]).toMatchObject([
      { rows: [{ address: failedThereRow.address }], has_more: true },
      { rows: [{ address: overdueHereRow.address }], has_more: true },
      { rows: [{ address: passedHereRow.address }], has_more: false, next_cursor: null },
    ]);
  });
});

describe('what list_activity refuses where goals are kept', () => {
  it('refuses a kind it does not know, naming the kinds of goals among those it does', async () => {
    const { list } = await goalsKept();

    expect(await list(ada, { kind: 'goals' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/kind',
          detail:
            'Expected needs_you, broken, new, comment, goal or goal_overdue, or several of them separated by commas',
        },
      ],
    });
  });
});

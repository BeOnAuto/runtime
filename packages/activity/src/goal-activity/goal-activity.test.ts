import { goalsText, leadGoalId, plainGoalId } from '@on.auto/playbooks/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  assessed,
  assessments,
  at,
  failedThere,
  failedThereRow,
  goalsKept,
  goalsNotKept,
  ofGoals,
  overdueHere,
  overdueHereRow,
  passedHere,
  passedHereRow,
} from '../testing/goal-activity.ts';
import { ada, listedOf, outputOf, type LedgerReads } from '../testing/harness.ts';
import { wordsIn } from './goal-words.ts';

const anyWords: unknown = expect.any(String);

describe('the words of the verdicts of goals', () => {
  it('are each goal’s own, for passed and for failed, read from the goals as saved', () => {
    expect(wordsIn(goalsText)).toEqual(
      new Map([
        [leadGoalId, { passed: 'Brought a customer', failed: 'Brought no customer' }],
        [plainGoalId, { passed: 'Orders came in', failed: 'Orders fell short' }],
      ]),
    );
  });

  it('are none for a playbook with no goals, or goals that no longer read as goals', () => {
    expect(wordsIn()).toEqual(new Map());
    expect(wordsIn('not goals')).toEqual(new Map());
  });
});

describe('the activity where goals are not kept', () => {
  it('refuses the kinds of goals, as any kind it does not know', async () => {
    const { list } = await goalsNotKept();

    expect(await list(ada, { kind: 'goal' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/kind',
          detail: anyWords,
        },
      ],
    });
  });

  it('lists no row of a goal and counts none, and refuses to mark the address of an assessment', async () => {
    const { list, mark } = await goalsNotKept();
    const listed = outputOf(await list(ada));

    expect(listed).toMatchObject({ counts: { needs_you: 0, broken: 0, new: 1, comments: 0 } });
    expect(JSON.stringify(listed)).not.toMatch(/goal|outcome/u);
    expect(
      await mark(ada, { items: [{ address: `finance/assessments/${passedHere}`, at: at('11:00') }] }),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/items/0' }] });
  });
});

describe('mark_activity_seen where goals are kept', () => {
  it('marks a verdict seen by the address of its assessment, which the count of goals and the row then show', async () => {
    const { list, mark } = await goalsKept();
    const marked = await mark(ada, { items: [{ address: `finance/assessments/${passedHere}`, at: at('11:00') }] });

    expect(outputOf(marked)).toMatchObject({ counts: { goals: 2 } });
    expect(outputOf(await list(ada, { kind: 'goal' }))).toMatchObject({
      rows: [{ seen: false }, { address: `finance/assessments/${passedHere}`, seen: true }],
    });
  });

  it('counts a verdict judged after its mark as unseen again', async () => {
    const harness = await goalsKept();
    await harness.mark(ada, { items: [{ address: `finance/assessments/${overdueHere}`, at: at('12:00') }] });
    await harness.record(assessments('finance', leadGoalId, overdueHere), assessed('passed', 'now', '14:00'));

    expect(outputOf(await harness.list(ada, { kind: 'goal' }))).toMatchObject({
      rows: [{ address: `finance/assessments/${overdueHere}`, seen: false }, {}, {}],
      counts: { goals: 3 },
    });
  });

  it('counts a verdict judged late as unseen by when it was recorded, though it names an earlier time', async () => {
    const harness = await goalsKept();
    const [newest] = listedOf(await harness.list(ada, { kind: 'goal' })).rows.map(({ cursor }) => cursor);
    const through = { through: String(newest) };
    const before = outputOf(await harness.mark(ada, through));
    await harness.record(assessments('finance', leadGoalId, overdueHere), {
      ...assessed('failed', 'now', '14:00'),
      data: { verdict: 'failed', at: at('01:00'), by: 'final', told: 'now' },
    });

    expect(before).toMatchObject({ counts: { goals: 1 } });
    expect(outputOf(await harness.mark(ada, through))).toMatchObject({ counts: { goals: 1 } });
    expect(listedOf(await harness.list(ada, { kind: 'goal' })).rows[0]).toMatchObject({
      address: `finance/assessments/${overdueHere}`,
      at: at('14:00'),
      seen: false,
    });
  });
});

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
    await harness.record(assessments('finance', leadGoalId, overdueHere), assessed('failed', 'now', '14:00'));

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

const goalsUnnamed: LedgerReads = (ledger) => ({
  ...ledger,
  namesHeldIn: (kind) => (kind.definitionType === 'goal' ? Effect.succeed([]) : ledger.namesHeldIn(kind)),
});

describe('list_activity where a goal left the playbook between the read of its rows and of its name', () => {
  it('leaves out the rows of a goal the playbook no longer names, which are the other playbook’s now', async () => {
    const { list } = await goalsKept(goalsUnnamed);

    expect(listedOf(await list(ada, ofGoals)).rows).toEqual([]);
  });
});

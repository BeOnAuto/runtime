import { describe, expect, it } from 'vitest';

import { assessed, assessments, at, goalsKept, overdueHere, passedHere } from '../testing/goal-activity.ts';
import { ada, listedOf, outputOf } from '../testing/harness.ts';

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
    await harness.record(assessments('finance', overdueHere), assessed('passed', 'now', '14:00'));

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
    await harness.record(assessments('finance', overdueHere), {
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

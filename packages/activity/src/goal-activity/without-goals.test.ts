import { describe, expect, it } from 'vitest';

import { at, goalsNotKept, passedHere } from '../testing/goal-activity.ts';
import { ada, outputOf } from '../testing/harness.ts';

describe('the activity where goals are not kept', () => {
  it('refuses the kinds of goals, as any kind it does not know', async () => {
    const { list } = await goalsNotKept();

    expect(await list(ada, { kind: 'goal' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/kind',
          detail: 'Expected needs_you, broken, new or comment, or several of them separated by commas',
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

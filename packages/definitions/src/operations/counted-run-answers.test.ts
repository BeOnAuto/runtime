import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import {
  contextsOf,
  contributing,
  goalsSaved,
  kept,
  playbookWith,
  replies,
  requests,
  runId,
  toAlpha,
  toward,
} from '../testing/counting-playbooks.ts';

describe('the answer of a workflow run started by hand that counts toward a goal', () => {
  it('names the goals it counts toward and says how to try a workflow without counting', async () => {
    const definitions = await playbookWith([toward('change-requests'), toward('replies')]);

    const ran = await definitions.call(kept.runDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'revise' }));

    expect(ran).toMatchObject({
      status: 'succeeded',
      output: {
        notices: [
          {
            kind: 'counts_toward_goals',
            detail:
              'This run counts toward Change requests and replies. To try a workflow without counting, run it with test: true.',
            certainty: 'exact',
          },
        ],
      },
    });
    expect(contributing.describeOutput({})).toBe('It ran.');
  });

  it('says nothing for a run started as a test, which is marked so on its facts', async () => {
    const definitions = await playbookWith([toward('change-requests')]);

    const ran = await definitions.call(
      kept.runDefinition,
      toAlpha(acmeAdmin, { type: 'workflow', name: 'revise', run_id: runId, test: true }),
    );

    expect(ran).toMatchObject({ status: 'succeeded' });
    expect(JSON.stringify(ran)).not.toContain('notices');
    expect(await contextsOf(definitions)).toEqual([
      { type: 'run_started', test: true },
      { type: 'run_succeeded', test: undefined },
    ]);
  });
});

describe('the answer of a workflow run started by hand that counts toward nothing', () => {
  it('says nothing for a workflow that counts toward no goal or only a retired one, and marks nothing for a run asked with test false, which does count', async () => {
    const none = await playbookWith();
    const onlyRetired = await playbookWith([toward('replies')]);
    await goalsSaved(onlyRetired, [requests, { ...replies, retired: true }]);
    const notATest = await playbookWith([toward('change-requests')]);

    const answers = await Promise.all([
      none.call(kept.runDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'revise' })),
      onlyRetired.call(kept.runDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'revise' })),
      notATest.call(
        kept.runDefinition,
        toAlpha(acmeAdmin, { type: 'workflow', name: 'revise', run_id: runId, test: false }),
      ),
    ]);

    expect(answers.map((ran) => JSON.stringify(ran).includes('notices'))).toEqual([false, false, true]);
    expect(await contextsOf(notATest)).toEqual([
      { type: 'run_started', test: undefined },
      { type: 'run_succeeded', test: undefined },
    ]);
  });
});

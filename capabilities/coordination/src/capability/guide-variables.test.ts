import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { testExpressionCheck } from '../testing/expression-checks.ts';
import { playbookOn } from '../testing/playbook.ts';
import { testPlaybookNames } from '../testing/test-sandbox.ts';
import { guideVariablesOf } from './guide-variables.ts';
import { makeWorkflowAdapter } from './workflow.ts';

const hour = 3_600_000;

const changedBy = {
  value: 'can be changed only by whoever runs the server',
  default: 'can be changed only by whoever runs the server',
};

describe('the values the workflow guide names', () => {
  it('are the longest a run may last, in days, hours or minutes, while the default stays the words the page writes', () => {
    expect(
      [30 * 24 * hour, 24 * hour, 2 * hour, 2.5 * hour, 2 * hour + 500].map(
        (mostDurationMs) => guideVariablesOf({ mostDurationMs })['workflow.longest_run'],
      ),
    ).toEqual([
      { value: '30 days from its start', default: '30 days from its start' },
      { value: '1 day from its start', default: '30 days from its start' },
      { value: '2 hours from its start', default: '30 days from its start' },
      { value: '150 minutes from its start', default: '30 days from its start' },
      { value: '120.008 minutes from its start', default: '30 days from its start' },
    ]);
    expect(guideVariablesOf()).toEqual({
      'workflow.longest_run': { value: '30 days from its start', default: '30 days from its start' },
      'workflow.bounds_changed_by': changedBy,
    });
  });

  it('are those of the longest run a document is checked against when it is saved', async () => {
    const workflow = makeWorkflowAdapter({
      runs: { start: () => Effect.die('A workflow started') },
      check: testExpressionCheck,
      mostDurationMs: 3 * hour,
      longestCallMs: 660_000,
      names: testPlaybookNames,
    });
    const playbook = playbookOn(memoryLedger(), [workflow]);
    const source = `document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: [{ pause: { wait: PT4H } }]\n`;

    expect(workflow.guide.variables).toEqual({
      'workflow.longest_run': { value: '3 hours from its start', default: '30 days from its start' },
      'workflow.bounds_changed_by': changedBy,
    });
    expect(await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'flow', source })).toMatchObject({
      status: 'rejected',
      issues: [
        {
          detail:
            'Line 2, column 23: at /do/0/pause/wait: This duration, 14400000 ms, is longer than the 10800000 ms a workflow may run',
        },
      ],
    });
  });
});

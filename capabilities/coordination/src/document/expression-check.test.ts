import { Unavailable } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import type { CheckJob } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeWorkflowAdapter } from '../capability/workflow.ts';
import { testExpressionCheck } from '../testing/expression-checks.ts';
import { playbookOn } from '../testing/playbook.ts';
import { testPlaybookNames } from '../testing/test-sandbox.ts';
import type { ExpressionCheck } from './expression-check.ts';

const header = "document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\n";

function saving(check: ExpressionCheck) {
  const workflow = makeWorkflowAdapter({
    runs: { start: () => Effect.die('A workflow started') },
    check,
    mostDurationMs: 2_592_000_000,
    longestCallMs: 1000,
    names: testPlaybookNames,
  });
  const playbook = playbookOn(memoryLedger(), [workflow]);
  return (source: string) => playbook.call(playbook.createDefinition, { type: 'workflow', name: 'flow', source });
}

const busy: ExpressionCheck = () => Effect.fail(new Unavailable({ detail: 'No checker was free' }));

function counted(): { readonly check: ExpressionCheck; readonly jobs: readonly CheckJob[] } {
  const jobs: CheckJob[] = [];
  return {
    jobs,
    check: (job) => {
      jobs.push(job);
      return testExpressionCheck(job);
    },
  };
}

describe('the expressions of a workflow checked when it is saved', () => {
  it('checks every expression of the document as one job, with the names each may read', async () => {
    const { check, jobs } = counted();
    const source = `${header}do:\n  - decide:\n      if: \${ $data.ready }\n      set: { count: '\${ $data.count + 1 }' }\n`;

    expect(await saving(check)(source)).toMatchObject({ status: 'succeeded' });
    expect(jobs).toEqual([
      {
        schemas: {},
        expressions: [
          { source: ' $data.ready ', names: ['$data', '$context', '$workflow', '$runtime', '$task'] },
          { source: ' $data.count + 1 ', names: ['$data', '$context', '$workflow', '$runtime', '$task', '$input'] },
        ],
      },
    ]);
  });

  it('refuses an expression that is not one, or names what its place lacks, at its line and pointer', async () => {
    const source = `${header}do:\n  - decide:\n      if: \${ $nope.ready }\n      set: { count: '\${ $data.count + }' }\n`;

    expect(await saving(testExpressionCheck)(source)).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The workflow document is not a workflow this runtime runs',
      issues: [
        { pointer: '/source', detail: "Line 4, column 11: at /do/0/decide/if: Cannot find name '$nope'." },
        {
          pointer: '/source',
          detail:
            'Line 5, column 21: at /do/0/decide/set/count: Expression expected; an expression is one TypeScript expression over $data, $context, $workflow, $runtime, $task, $input',
        },
      ],
    });
  });

  it('runs no check for a document without expressions, and is unavailable when the check does not answer', async () => {
    const { check, jobs } = counted();

    expect(await saving(check)(`${header}do: []\n`)).toMatchObject({ status: 'succeeded' });
    expect(jobs).toEqual([]);
    expect(await saving(busy)(`${header}do:\n  - decide: { if: '\${ true }', set: { a: 1 } }\n`)).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'No checker was free',
    });
  });
});

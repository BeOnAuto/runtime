import type { Outcome } from '@on.auto/operations';
import { Effect, Struct } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testExpressionCheck } from '../testing/expression-checks.ts';
import { testPlaybookNames } from '../testing/test-sandbox.ts';
import { workflowPlaybook, type WorkflowPlaybook } from '../testing/workflow-playbook.ts';
import { makeWorkflowAdapter } from './workflow.ts';

const anyWords: unknown = expect.any(String);

const header = `document:
  dsl: '1.0.3'
  namespace: acme
  name: greeting
  version: '1.0.0'
`;

const steps = `do:
  - greet:
      call: run_definition
      with: { type: echo, name: greet, input: { name: '\${ $data.name }' } }
  - shape:
      set:
        status: measured
        greeted: \${ $data.input.name }
`;

const contributes = `contributes:
  - goal: greeted-people
    purpose: Counts each person greeted.
    when: \${ $data.status == "measured" }
    measures: /count
`;

const plain = `${header}${steps}`;

const contributing = `${header}${contributes}${steps}`;

const refusedSave = {
  status: 'rejected',
  reason: 'invalid_input',
  detail: 'The workflow document is not a workflow this runtime runs',
};

const atTheCondition: unknown = expect.stringMatching(/^Line 9, column 11: at \/contributes\/0\/when: /u);

function ending(outcome: Outcome) {
  return outcome.status === 'succeeded'
    ? Struct.omit(outcome.output, ['run_id', 'name', 'started_at', 'finished_at'])
    : outcome;
}

let kept: WorkflowPlaybook;
let notKept: WorkflowPlaybook;

beforeAll(async () => {
  [kept, notKept] = await Promise.all([workflowPlaybook({ goals: true }), workflowPlaybook()]);
  await Promise.all(
    [kept, notKept].map((playbook) =>
      playbook.call(playbook.createDefinition, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' }),
    ),
  );
});

afterAll(async () => {
  await Promise.all([kept.close(), notKept.close()]);
});

function saving(playbook: WorkflowPlaybook, name: string, source: string) {
  return playbook.call(playbook.createDefinition, { type: 'workflow', name, source });
}

describe('saving a workflow that carries contributes where goals are not kept', () => {
  it('is refused as a key the document does not know, in the words the DSL gives any key it does not know', async () => {
    const nested = `${header}  contributes: []\n${steps}`;

    expect([await saving(notKept, 'contributing', contributing), await saving(notKept, 'nested', nested)]).toEqual([
      {
        ...refusedSave,
        issues: [
          { detail: 'Line 1, column 1: It has contributes, which the DSL does not know here', pointer: '/source' },
        ],
      },
      {
        ...refusedSave,
        issues: [
          {
            detail: 'Line 2, column 3: at /document: It has contributes, which the DSL does not know here',
            pointer: '/source',
          },
        ],
      },
    ]);
  });

  it('is refused so even when its condition would not type-check', async () => {
    const source = contributing.replace('$data.status == "measured"', '$context.nothing ===');

    expect(await saving(notKept, 'unchecked', source)).toEqual({
      ...refusedSave,
      issues: [{ detail: anyWords, pointer: '/source' }],
    });
  });

  it('leaves a workflow without it saved as before', async () => {
    expect(await saving(notKept, 'plain', plain)).toMatchObject({ status: 'succeeded', output: { version: 1 } });
  });
});

describe('saving a workflow that carries contributes where goals are kept', () => {
  it('is saved', async () => {
    expect(await saving(kept, 'contributing', contributing)).toMatchObject({
      status: 'succeeded',
      output: { name: 'contributing', version: 1 },
    });
  });

  it('is refused when its condition does not type-check as an expression over $data', async () => {
    const source = contributing.replace('$data.status == "measured"', '$context.status');

    expect(await saving(kept, 'outside-its-data', source)).toMatchObject({
      ...refusedSave,
      issues: [{ detail: atTheCondition, pointer: '/source' }],
    });
  });
});

describe('a saved workflow that carries contributes', () => {
  it('is prepared to run on a host that keeps no goals, with the document the engine runs left without it', async () => {
    const notKeeping = makeWorkflowAdapter({
      runs: kept.host,
      check: testExpressionCheck,
      mostDurationMs: 2_592_000_000,
      longestCallMs: 660_000,
      names: testPlaybookNames,
    });
    const prepared = await Effect.runPromise(notKeeping.prepare(contributing));

    expect(prepared.summary.details).toMatchObject({ contributes: [{ goal: 'greeted-people' }] });
  });

  it('runs exactly as the same workflow without it', async () => {
    await saving(kept, 'plain', plain);
    const ran = async (name: string, runId: string): Promise<Outcome> => {
      await kept.call(kept.runDefinition, { type: 'workflow', name, input: { name: 'Ada' }, run_id: runId });
      return kept.settled(runId);
    };
    const [withIt, withoutIt] = await Promise.all([
      ran('contributing', '0199a3c4-7d2e-7c1a-9b3f-4444444444a1'),
      ran('plain', '0199a3c4-7d2e-7c1a-9b3f-4444444444a2'),
    ]);

    expect(ending(withIt)).toEqual(ending(withoutIt));
    expect(ending(withIt)).toMatchObject({ status: 'succeeded', output: { status: 'measured', greeted: 'Ada' } });
  });
});

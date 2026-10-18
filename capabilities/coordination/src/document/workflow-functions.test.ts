import type { RejectedCall } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { testPlaybookNames, testWorkflowPolicy as workflowPolicy } from '../testing/test-sandbox.ts';
import { workflow } from '../testing/workflows.ts';
import { definitionsCalledIn, workflowFunctionsOf } from './workflow-functions.ts';
import { summaryOf } from './workflow-summary.ts';

const workflowFunctions = workflowFunctionsOf(testPlaybookNames);

const workflowRun = { type: 'workflow', name: 'monthly' };

function refusedBy(reason: string): RejectedCall {
  return { status: 'rejected', reason, detail: 'The step said no.' };
}

function rejectedIn(tasks: string): readonly string[] {
  return workflowPolicy(workflow(`do:\n${tasks}`)).map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

describe('the functions a workflow calls', () => {
  it('are run_definition alone: a workflow reaches the world through the definitions of its playbook', () => {
    expect(
      rejectedIn(`
  - fetch: { call: http, with: {} }
  - log: { call: log, with: {} }
`),
    ).toEqual([
      '/do/0/fetch/call: call: http is not allowed: a workflow reaches the world only through its playbook functions; call run_definition',
      '/do/1/log/call: call: log names no function; the one function is run_definition',
    ]);
  });

  it('are named when a document brings catalogs or functions', () => {
    expect(
      workflowPolicy(workflow('use: { catalogs: {}, functions: {} }\ndo: []')).map(({ detail }) => detail),
    ).toEqual([
      'catalogs are not supported in this version: a workflow calls only run_definition',
      'reusable functions are not supported in this version: call run_definition directly',
    ]);
  });
});

describe('a call of run_definition', () => {
  it('is described by the definition it runs, or by its name when that cannot be read', () => {
    expect([
      workflowFunctions.describe('run_definition', { type: 'reasoning', name: 'summarize' }),
      workflowFunctions.describe('run_definition', { type: 'echo', name: 'greet' }),
      workflowFunctions.describe('run_definition', { name: 'summarize' }),
      workflowFunctions.describe('run_definition', 'summarize'),
    ]).toEqual(['the reasoning function summarize', 'the echo definition greet', 'run_definition', 'run_definition']);
  });

  it('says a workflow it ran stopped when one of its steps did, and what its reason did otherwise', () => {
    expect([
      workflowFunctions.refusal?.('run_definition', workflowRun, refusedBy('invalid_input')),
      workflowFunctions.refusal?.('run_definition', workflowRun, refusedBy('unavailable')),
      workflowFunctions.refusal?.('run_definition', workflowRun, refusedBy('conflict')),
      workflowFunctions.refusal?.('run_definition', workflowRun, refusedBy('unanswered')),
      workflowFunctions.refusal?.('run_definition', workflowRun, refusedBy('cancelled')),
      workflowFunctions.refusal?.('run_definition', workflowRun, refusedBy('not_found')),
      workflowFunctions.refusal?.(
        'run_definition',
        { type: 'computation', name: 'month-window' },
        refusedBy('invalid_input'),
      ),
      workflowFunctions.refusal?.('run_definition', 'monthly', refusedBy('invalid_input')),
    ]).toEqual([
      'stopped',
      'stopped',
      'stopped',
      'stopped',
      'was cancelled',
      'could not be found',
      'refused its input',
      'refused its input',
    ]);
  });
});

describe('a call of run_definition of a workflow that refused with the issues of an input', () => {
  it('says the workflow refused its input when the rejection is of the kind input_schema, and stopped otherwise', () => {
    const issues = [{ pointer: '/input/month', detail: 'month: expected text.' }];
    const refused: RejectedCall = {
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'month: expected text.',
      issues,
    };

    expect([
      workflowFunctions.refusal?.('run_definition', workflowRun, { ...refused, kind: 'input_schema' }),
      workflowFunctions.refusal?.('run_definition', workflowRun, refused),
    ]).toEqual(['refused its input', 'stopped']);
  });
});

describe('the definitions a workflow calls', () => {
  it('are those its calls of run_definition name, nested or not, in the order of the document and each once', () => {
    expect(
      definitionsCalledIn(
        workflow(`do:
  - review:
      call: run_definition
      with: { type: reasoning, name: review-brief, input: {} }
  - each:
      for: { each: brief, in: '\${ $data.briefs }' }
      do:
        - again: { call: run_definition, with: { type: reasoning, name: review-brief } }
        - pace: { call: run_definition, with: { type: computation, name: campaign-pace } }
  - guarded:
      try:
        - ask: { call: run_definition, with: { type: interaction, name: ask-approval } }
      catch:
        do:
          - note: { call: run_definition, with: { type: workflow, name: note-failure } }
  - both:
      fork:
        branches:
          - left: { call: run_definition, with: { type: recall, name: review-history } }
  - chosen: { call: run_definition, with: { type: reasoning, name: '\${ $data.reviewer }' } }
  - typed: { call: run_definition, with: { type: '\${ $data.type }', name: review-brief } }
  - plain: { set: { done: true } }
`),
      ),
    ).toEqual([
      { type: 'reasoning', name: 'review-brief' },
      { type: 'computation', name: 'campaign-pace' },
      { type: 'interaction', name: 'ask-approval' },
      { type: 'workflow', name: 'note-failure' },
      { type: 'recall', name: 'review-history' },
    ]);
  });

  it('are the calls the details of its summary keep, and a workflow that calls none keeps no details', () => {
    const calling = workflow(
      'do:\n  - pace: { call: run_definition, with: { type: computation, name: campaign-pace } }',
    );

    expect(summaryOf(calling).details).toEqual({ calls: [{ type: 'computation', name: 'campaign-pace' }] });
    expect(summaryOf(workflow('do:\n  - plain: { set: { done: true } }'))).not.toHaveProperty('details');
  });
});

describe('the policy of run_definition', () => {
  it('takes a type, a name and an input, as expressions or literals', () => {
    expect(
      rejectedIn(`
  - summarize:
      call: run_definition
      with: { type: reasoning, name: '\${ $data.definition }', input: { text: '\${ $data.text }' } }
`),
    ).toEqual([]);
  });

  it('rejects arguments it does not take and arguments it lacks', () => {
    expect(
      rejectedIn(`
  - nothing: { call: run_definition }
  - partial: { call: run_definition, with: { name: 3, model: big } }
`),
    ).toEqual([
      '/do/0/nothing/with: run_definition takes with: { type, name, input }',
      '/do/1/partial/with/model: run_definition takes no argument model',
      '/do/1/partial/with/type: run_definition needs a string type',
      '/do/1/partial/with/name: run_definition needs a string name',
    ]);
  });

  it('takes a call of another workflow, with expressions in its arguments', () => {
    expect(
      rejectedIn(`
  - nested: { call: run_definition, with: { type: workflow, name: other, input: ['\${ $data.a }'] } }
`),
    ).toEqual([]);
  });
});

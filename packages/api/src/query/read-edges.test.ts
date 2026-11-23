import { describe, expect, it } from 'vitest';

import type { BoundInput } from './query-schema.ts';
import { definitionsCalledIn, READ_EDGES } from './read-edges.ts';

function boundBy(operation: string, field: string): (item: BoundInput, playbook?: string) => unknown {
  const read = READ_EDGES.find((edge) => edge.operation === operation)?.reads?.find((each) => each.field === field);
  return (item, playbook = 'sales') => read?.input(item, playbook);
}

const workflow = `
do:
  - total:
      call: run_definition
      with: { type: computation, name: total-order }
  - nested:
      do:
        - ask:
            call: run_definition
            with: { type: interaction, name: approve-order }
        - again:
            call: run_definition
            with: { type: computation, name: total-order }
  - other:
      call: http
      with: { type: computation, name: not-a-call }
  - unnamed:
      call: run_definition
      with: { type: computation }
  - loose:
      call: run_definition
`;

describe('the definitions a workflow’s document runs', () => {
  it('finds each definition run with run_definition, once, wherever its step is nested', () => {
    expect(definitionsCalledIn(workflow)).toEqual([
      { type: 'computation', name: 'total-order' },
      { type: 'interaction', name: 'approve-order' },
    ]);
  });

  it.each([
    ['a document that does not parse', 'do: [unclosed'],
    ['no document', undefined],
    ['a document that runs nothing', 'do: []'],
  ])('finds none in %s', (_, source) => {
    expect(definitionsCalledIn(source)).toEqual([]);
  });
});

describe('the reads bound to a definition', () => {
  it.each([
    ['definition', 'list_definitions', { type: 'workflow', name: 'w' }, { type: 'workflow', name: 'w' }],
    ['definition', 'list_definitions', { type: 'workflow', name: '' }, undefined],
    ['runs', 'list_definitions', { type: 'workflow', name: 'w' }, { type: 'workflow', name: 'w' }],
    ['runs', 'get_definition', { name: 'w' }, undefined],
    [
      'comments',
      'get_definition',
      { type: 'workflow', name: 'w', version: 2 },
      { address: 'sales/definitions/workflow/w/2' },
    ],
    ['comments', 'get_definition', { type: 'workflow', name: 'w' }, undefined],
    ['called', 'get_definition', { source: workflow }, definitionsCalledIn(workflow)],
  ] as const)('binds %s of %s to %j as %j', (field, operation, item, input) => {
    expect(boundBy(operation, field)(item)).toEqual(input);
  });
});

describe('the reads bound to a run', () => {
  it.each([
    ['events', 'list_runs', { run_id: 'r1' }, { run_id: 'r1' }],
    ['history', 'list_runs', { run_id: 'r1' }, { run_id: 'r1' }],
    ['run', 'list_runs', { run_id: 'r1' }, { run_id: 'r1' }],
    ['comments', 'list_runs', { run_id: 'r1' }, { address: 'sales/runs/r1' }],
    ['comments', 'get_run', {}, undefined],
    ['events', 'get_run', {}, undefined],
  ] as const)('binds %s of %s to %j as %j', (field, operation, item, input) => {
    expect(boundBy(operation, field)(item)).toEqual(input);
  });

  it('binds no run for a run a read of its own does not repeat', () => {
    expect(READ_EDGES.find((edge) => edge.operation === 'get_run')?.reads?.map(({ field }) => field)).toEqual([
      'events',
      'history',
      'comments',
    ]);
  });
});

describe('the reads bound to an open request', () => {
  it.each([
    ['the last of its causes', { causes: ['r2', '', 'r1'], within: { run_id: 'w1' } }, { run_id: 'r1' }],
    ['the workflow run that asked, with no causes', { causes: [], within: { run_id: 'w1' } }, { run_id: 'w1' }],
    ['the workflow run that asked, with causes left out', { within: { run_id: 'w1' } }, { run_id: 'w1' }],
    ['none, asked by no run of a chain', { within: null }, undefined],
  ] as const)('reads the history of %s', (_, item, input) => {
    expect(boundBy('list_interactions', 'first_run_history')(item)).toEqual(input);
  });

  it.each([
    [{ within: { workflow: 'approve' } }, { type: 'workflow', name: 'approve' }],
    [{ within: {} }, undefined],
    [{}, undefined],
  ] as const)('reads the workflow that asked %j', (item, input) => {
    expect(boundBy('list_interactions', 'workflow')(item)).toEqual(input);
  });
});

describe('the reads bound to a line of activity', () => {
  it.each([
    ['its run', { run_id: 'r1', about: 'sales/runs/r2' }, { run_id: 'r1' }],
    ['the run it is about', { run_id: null, about: 'sales/runs/r2/parts/row' }, { run_id: 'r2' }],
    [
      'the run of the request it is about',
      { about: 'sales/0a1b2c3d-0000-4000-8000-000000000001' },
      { run_id: '0a1b2c3d-0000-4000-8000-000000000001' },
    ],
    ['none, about no run', { about: 'playbooks/sales' }, undefined],
    ['none, about nothing', {}, undefined],
  ] as const)('reads %s', (_, item, input) => {
    expect(boundBy('list_activity', 'run')(item)).toEqual(input);
  });
});

describe('the reads bound to a goal', () => {
  it.each([
    [{ id: 'orders' }, { goal: 'orders' }],
    [{}, undefined],
  ] as const)('reads the results of the goal %j', (item, input) => {
    expect(boundBy('get_playbook_goals', 'results')(item)).toEqual(input);
  });
});

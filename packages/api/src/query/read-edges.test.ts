import { describe, expect, it } from 'vitest';

import type { BoundInput } from './query-schema.ts';
import { definitionsCalledIn, READ_EDGES } from './read-edges.ts';

function readOf(operation: string, field: string) {
  return READ_EDGES.find((edge) => edge.operation === operation)?.reads?.find((each) => each.field === field);
}

function boundBy(
  operation: string,
  field: string,
): (item: BoundInput, playbook?: string, first?: Readonly<Record<string, unknown>>) => unknown {
  const read = readOf(operation, field);
  return (item, playbook = 'sales', first = {}) => read?.input(item, playbook, first);
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

function marked(...runs: readonly string[]): BoundInput {
  return { marks: runs.map((run) => ({ milestone: 'received', run })) };
}

describe('the reads bound to a goal', () => {
  it.each([
    [{ id: 'orders' }, { goal: 'orders' }],
    [{}, undefined],
  ] as const)('reads the results of the goal %j', (item, input) => {
    expect(boundBy('get_playbook_goals', 'results')(item)).toEqual(input);
  });

  it.each([
    [
      'each run that marked a thing still open, once',
      { assessments: { current: marked('r1'), in_flight: [marked('r2', 'r1'), marked('r3')] } },
      [{ run_id: 'r1' }, { run_id: 'r2' }, { run_id: 'r3' }],
    ],
    ['none where nothing is open', { assessments: { current: null, in_flight: [] } }, []],
    ['none where the goal says nothing of its things', {}, []],
    ['none where its marks are not a list', { assessments: { current: { marks: 'r1' } } }, []],
    ['no mark without its run', { assessments: { in_flight: [{ marks: [{ milestone: 'received' }, 'r9'] }] } }, []],
  ] as const)('reads %s, whole', (_, item, input) => {
    expect(boundBy('get_playbook_goals', 'marked_by')(item)).toEqual(input);
  });
});

const CAME_IN = '2026-11-20T10:00:00.000Z';

const minutesAfter = (at: string, minutes: number) => new Date(Date.parse(at) + minutes * 60_000).toISOString();

const ran = (run: string, name: string, minutes: number, within?: string) => ({
  run_id: run,
  name,
  status: 'succeeded',
  started_at: minutesAfter(CAME_IN, minutes),
  ...(within === undefined ? {} : { within: { run_id: within, step: 'do/0/send' } }),
});

const refunds = (assessments: Readonly<Record<string, unknown>>): BoundInput => ({
  id: 'refunds-decided',
  milestones: [{ id: 'received' }, { id: 'decided' }],
  contributions: [
    { workflow: 'intake', marks: 'received' },
    { workflow: 'decide', marks: 'decided' },
    { workflow: 'notes' },
  ],
  assessments: { current: null, in_flight: [], closed: { latest: [] }, ...assessments },
});

const openSince = (thing: string, at: string, run?: string) => ({
  per: { id: thing },
  window: { opens: at },
  marks: run === undefined ? [] : [{ milestone: 'received', at, run }],
});

const ended = (thing: string, opens: string, at: string) => ({ per: { id: thing }, window: { opens }, at });

const NEAR = [1, -1, 2, -2, 3, -3, 4, -4, 4.5, -4.5].map((minutes, at) => ran(`near-${String(at)}`, 'intake', minutes));

const LISTED = [
  ...NEAR,
  ran('far', 'intake', 30),
  ran('decided', 'decide', 20),
  ran('sent', 'send-email', 21, 'decided'),
  ran('decided-before', 'decide', -10),
];

const runsBehind = (goal: BoundInput, first: Readonly<Record<string, unknown>>) =>
  boundBy('get_playbook_goals', 'runs_behind')(goal, 'refunds', first);

const theRuns = (...runs: readonly string[]) => runs.map((run) => ({ run_id: run }));

const NEAREST = Array.from({ length: 8 }, (_, at) => `near-${String(at)}`);

describe('the runs behind the things of a goal', () => {
  it('reads first the latest runs of the playbook and the first page of the goal’s results', () => {
    expect(readOf('get_playbook_goals', 'runs_behind')?.first?.(refunds({}))).toEqual({
      runs: { operation: 'list_runs', input: { limit: 100 } },
      results: { operation: 'list_goal_results', input: { goal: 'refunds-decided' } },
    });
    expect(readOf('get_playbook_goals', 'runs_behind')?.first?.({})).toEqual({
      runs: { operation: 'list_runs', input: { limit: 100 } },
    });
  });

  it('reads the runs that marked an open thing, the eight started nearest when it came in, the runs that answered it and the runs their steps started, each once', () => {
    const goal = refunds({ in_flight: [openSince('req-1', CAME_IN, 'marking')] });

    expect(runsBehind(goal, { runs: { runs: LISTED } })).toEqual(theRuns('marking', ...NEAREST, 'decided', 'sent'));
  });

  it('reads those of a thing that ended, between it coming in and its result, and of one among the goal’s results', () => {
    const goal = refunds({ closed: { latest: [ended('req-0', CAME_IN, minutesAfter(CAME_IN, 25))] } });
    const results = { items: [ended('req-9', minutesAfter(CAME_IN, 30), minutesAfter(CAME_IN, 40))] };

    expect(runsBehind(goal, { runs: { runs: LISTED }, results })).toEqual(
      theRuns(...NEAREST, 'decided', 'sent', 'far'),
    );
  });
});

describe('the runs behind the things of a goal, where the runs say little', () => {
  it('reads only the marking runs, earliest mark first, where the runs could not be listed', () => {
    const goal = refunds({
      current: {
        per: { id: 'req-1' },
        marks: [
          { milestone: 'decided', at: minutesAfter(CAME_IN, 9), run: 'later' },
          { milestone: 'received', at: CAME_IN, run: 'marking' },
          { milestone: 'noted', at: CAME_IN },
        ],
      },
    });

    expect(runsBehind(goal, {})).toEqual(theRuns('marking', 'later'));
  });

  it('passes over a run listed with no id or no start', () => {
    const goal = refunds({ in_flight: [openSince('req-1', CAME_IN)] });
    const runs = [{ run_id: 'unstarted', name: 'intake' }, { started_at: CAME_IN }, ran('near', 'intake', 1)];

    expect(runsBehind(goal, { runs: { runs } })).toEqual(theRuns('near'));
  });

  it('reads none where the runs listed carry their output, as the records are read from the list', () => {
    const goal = refunds({ in_flight: [openSince('req-1', CAME_IN, 'marking')] });

    expect(runsBehind(goal, { runs: { runs: [{ ...ran('whole', 'intake', 1), output: {} }] } })).toEqual([]);
  });

  it.each([
    ['no things', refunds({})],
    ['a goal that says nothing of its things', { id: 'g' }],
    ['a thing with no id', refunds({ in_flight: [{ window: { opens: CAME_IN } }] })],
    ['a thing with no moment it came in', refunds({ in_flight: [{ per: { id: 'req-2' } }] })],
  ])('reads none for %s', (_, goal) => {
    expect(runsBehind(goal, { runs: { runs: LISTED } })).toEqual([]);
  });
});

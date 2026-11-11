import assert from 'node:assert/strict';
import { test } from 'node:test';

import { outcomeOf, planIn, toolsAskedIn, type PlannedDefinition, type Shape } from './grading.ts';

function planned(...types: readonly string[]): readonly PlannedDefinition[] {
  return types.map((type) => ({ type }));
}

function workflowCalling(count: number): PlannedDefinition {
  return { type: 'workflow', calls: Array.from({ length: count }, (_, index) => `step-${index}`) };
}

await test('the plan is the last JSON object that lists definitions, wherever it sits in the answer', () => {
  const plan = '{"definitions":[{"type":"reasoning","name":"judge"},{"type":"workflow","calls":["judge"]}]}';

  assert.deepEqual(planIn(plan), [{ type: 'reasoning' }, { type: 'workflow', calls: ['judge'] }]);
  assert.deepEqual(planIn(`I would build this {see below}.\n\`\`\`json\n${plan}\n\`\`\`\nDone {ok}.`), [
    { type: 'reasoning' },
    { type: 'workflow', calls: ['judge'] },
  ]);
  assert.deepEqual(planIn(`{"plan": ${plan}}`), [{ type: 'reasoning' }, { type: 'workflow', calls: ['judge'] }]);
  assert.deepEqual(planIn(`{"definitions":[{"type":"lookup"}]}\nOn second thought: ${plan}`), [
    { type: 'reasoning' },
    { type: 'workflow', calls: ['judge'] },
  ]);
  assert.deepEqual(planIn('{"definitions":[{"type":"reasoning","tools":null,"calls":null}]}'), [
    { type: 'reasoning', tools: null, calls: null },
  ]);
});

await test('an answer with no plan, or with a plan that is not one, has none', () => {
  assert.equal(planIn(''), undefined);
  assert.equal(planIn('I would make one reasoning function.'), undefined);
  assert.equal(planIn('{"definitions": "a reasoning function"}'), undefined);
  assert.equal(planIn('{"definitions":[{"type":"reasoning"}'), undefined);
});

await test('the tools a model asks to load are read from the last JSON object that names them', () => {
  assert.deepEqual(toolsAskedIn('I need these: {"load":["create_definition","get_guide"]}'), [
    'create_definition',
    'get_guide',
  ]);
  assert.deepEqual(toolsAskedIn('{"definitions":[]}'), []);
});

const cases: readonly (readonly [Shape, string, readonly PlannedDefinition[], string])[] = [
  ['J', 'one reasoning function and its workflow', [...planned('reasoning'), workflowCalling(1)], 'right'],
  ['J', 'one reasoning function alone', planned('reasoning'), 'right'],
  ['J', 'no reasoning function', planned('computation'), 'under-split'],
  ['J', 'a computation beside the judgement', planned('reasoning', 'computation'), 'over-split'],
  ['J', 'two reasoning functions', planned('reasoning', 'reasoning'), 'over-split'],
  ['C', 'one computation function', planned('computation'), 'right'],
  ['C', 'a reasoning function that calculates', planned('reasoning'), 'under-split'],
  ['C', 'a reasoning function beside the computation', planned('computation', 'reasoning'), 'over-split'],
  [
    'R',
    'a lookup, a computation and a reasoning function, run in three steps',
    [...planned('lookup', 'computation', 'reasoning'), workflowCalling(3)],
    'right',
  ],
  [
    'R',
    'a workflow of two steps',
    [...planned('lookup', 'computation', 'reasoning'), workflowCalling(2)],
    'under-split',
  ],
  [
    'R',
    'a reasoning function that reads with its tools',
    [...planned('lookup', 'computation'), { type: 'reasoning', tools: ['records/list_records'] }, workflowCalling(3)],
    'under-split',
  ],
  [
    'R',
    'an interaction beside the parts',
    [...planned('lookup', 'computation', 'reasoning', 'interaction'), workflowCalling(4)],
    'over-split',
  ],
  [
    'A',
    'a lookup, a reasoning function and two interactions, run in four steps',
    [...planned('lookup', 'reasoning', 'interaction', 'interaction'), workflowCalling(4)],
    'right',
  ],
  ['A', 'one interaction', [...planned('lookup', 'reasoning', 'interaction'), workflowCalling(4)], 'under-split'],
  [
    'A',
    'a computation beside the parts',
    [...planned('lookup', 'reasoning', 'interaction', 'interaction', 'computation'), workflowCalling(5)],
    'over-split',
  ],
  ['P', 'a prediction and a computation', planned('prediction', 'computation'), 'right'],
  ['P', 'a prediction and a reasoning function after a lookup', planned('lookup', 'prediction', 'reasoning'), 'right'],
  ['P', 'a reasoning function that forecasts', planned('reasoning'), 'under-split'],
  ['P', 'a prediction alone', planned('prediction'), 'under-split'],
  ['P', 'an interaction beside the parts', planned('prediction', 'computation', 'interaction'), 'over-split'],
  ['M', 'one reasoning function that names tools', [{ type: 'reasoning', tools: ['records/*'] }], 'right'],
  ['M', 'one reasoning function that names none', [{ type: 'reasoning', tools: [] }], 'under-split'],
  [
    'M',
    'a lookup before the reasoning function',
    [{ type: 'lookup' }, { type: 'reasoning', tools: ['records/*'] }],
    'over-split',
  ],
  [
    'M',
    'two reasoning functions',
    [
      { type: 'reasoning', tools: ['records/*'] },
      { type: 'reasoning', tools: ['records/*'] },
    ],
    'over-split',
  ],
  ['J', 'a definition with no type', [{}], 'under-split'],
];

await test('each plan is right, under-split or over-split by the shape of its brief', () => {
  assert.deepEqual(
    cases.map(([shape, , definitions]) => outcomeOf(shape, definitions)),
    cases.map(([, , , outcome]) => outcome),
  );
});

function readCalculateWritePlan(name: string, tool: string): readonly PlannedDefinition[] {
  return [
    { type: 'lookup', tools: [tool] },
    { type: 'computation' },
    { type: 'reasoning', tools: [] },
    { type: 'workflow', calls: [name, `${name}-2`, `${name}-3`] },
  ];
}

await test('the outcome reads only the types, whether a reasoning function names tools, and how many steps call', () => {
  assert.equal(outcomeOf('R', readCalculateWritePlan('weekly-sales', 'shop/orders')), 'right');
  assert.equal(outcomeOf('R', readCalculateWritePlan('floor-energy', 'building/meters')), 'right');
});

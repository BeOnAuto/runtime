import { describe, expect, it } from 'vitest';

import { testFunctions } from '../testing/driver-inputs.ts';
import { workflow } from '../testing/workflows.ts';
import type { Json } from './json.ts';
import { policyOf } from './policy.ts';

const rejectionsOf = policyOf(testFunctions);

function nestedDo(levels: number): string {
  return levels === 1 ? '[{ leaf: { set: { done: true } } }]' : `[{ inner: { do: ${nestedDo(levels - 1)} } }]`;
}

function pointerOfList(levels: number): string {
  return `/do${'/0/inner/do'.repeat(levels - 1)}`;
}

function nestedValue(depth: number): Json {
  return depth === 0 ? 'bottom' : [nestedValue(depth - 1)];
}

function documentNesting(depth: number) {
  return { ...workflow('do: []'), use: { errors: { deep: { list: nestedValue(depth) } } } };
}

describe('the nesting of task lists', () => {
  it('may reach 64 levels', () => {
    expect(rejectionsOf(workflow(`do: ${nestedDo(64)}`))).toStrictEqual([]);
  });

  it('is rejected one level past that, at the list that is too deep, before anything else is checked', () => {
    expect(rejectionsOf(workflow(`use: { secrets: {} }\ndo: ${nestedDo(65)}`))).toStrictEqual([
      { pointer: pointerOfList(65), detail: 'The document nests tasks more than 64 levels deep', forbidden: true },
    ]);
  });

  it.each([
    ['for', 64, "{ for: { in: '${ [] }' }, do: [{ leaf: { set: {} } }] }", '/do'],
    ['try', 64, '{ try: [{ leaf: { set: {} } }], catch: {} }', '/try'],
    ['catch', 63, '{ try: [], catch: { do: [{ again: { do: [] } }] } }', '/catch/do/0/again/do'],
    ['fork', 64, '{ fork: { branches: [{ leaf: { set: {} } }] } }', '/fork/branches'],
  ])('counts the task list of %s', (_kind, levels, task, list) => {
    const document = workflow(
      `do: ${nestedDo(levels).replace('{ leaf: { set: { done: true } } }', `{ last: ${task} }`)}`,
    );

    expect(rejectionsOf(document)).toStrictEqual([
      {
        pointer: `${pointerOfList(levels)}/0/last${list}`,
        detail: 'The document nests tasks more than 64 levels deep',
        forbidden: true,
      },
    ]);
  });
});

describe('the nesting of values in a document', () => {
  it('may reach 512 levels, and is rejected past that, at the value that is too deep', () => {
    expect(rejectionsOf(documentNesting(508))).toStrictEqual([]);
    expect(rejectionsOf(documentNesting(509))).toStrictEqual([
      {
        pointer: `/use/errors/deep/list${'/0'.repeat(508)}`,
        detail: 'The document nests values more than 512 levels deep',
        forbidden: true,
      },
    ]);
  });
});

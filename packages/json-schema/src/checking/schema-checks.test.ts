import { describe, expect, it } from 'vitest';

import { issuesDetail, schemaCheckOf } from './schema-checks.ts';

describe('the check of a value against a JSON Schema', () => {
  it('names at most three issues of the value, and none of a value the schema accepts', () => {
    const check = schemaCheckOf({ type: 'array', items: { type: 'string' } }, { what: 'output', nesting: 512 });

    expect(check([1, 2, 3, 4])).toEqual([
      { pointer: '/0', detail: 'Expected string' },
      { pointer: '/1', detail: 'Expected string' },
      { pointer: '/2', detail: 'Expected string' },
    ]);
    expect(check('x')).toEqual([{ pointer: '', detail: 'Expected array' }]);
    expect(check(['x'])).toEqual([]);
  });

  it('refuses a value nested deeper than the nesting it is given, naming what the value is', () => {
    const check = schemaCheckOf({}, { what: 'view', nesting: 2 });

    expect([check([[1]]), check([[[1]]])]).toEqual([
      [],
      [{ pointer: '', detail: 'The view nests more than 2 levels' }],
    ]);
  });

  it('names the issues of a further check it is given, within the same three', () => {
    const check = schemaCheckOf(
      { type: 'array', items: { type: 'string' } },
      { what: 'output', nesting: 512, further: () => [{ pointer: '', detail: 'Expected two items' }] },
    );

    expect([check(['x']), check([1, 2, 3])]).toEqual([
      [{ pointer: '', detail: 'Expected two items' }],
      [
        { pointer: '/0', detail: 'Expected string' },
        { pointer: '/1', detail: 'Expected string' },
        { pointer: '/2', detail: 'Expected string' },
      ],
    ]);
  });

  it('refuses every value when the schema it is given does not compile, naming why', () => {
    expect(schemaCheckOf('not a schema', { what: 'output', nesting: 512 })(1)).toEqual([
      { pointer: '', detail: 'A schema is a JSON object' },
    ]);
  });
});

describe('the words of the issues a check found', () => {
  it('name each issue at its pointer, or as the value itself at the root, one after another', () => {
    expect(
      issuesDetail(
        [
          { pointer: '', detail: 'Expected object' },
          { pointer: '/spring/0', detail: 'Expected string' },
        ],
        'view',
      ),
    ).toBe('the view: Expected object; /spring/0: Expected string');
  });
});

import { describe, expect, it } from 'vitest';

import { unrenderableFor, unworkable } from './render-refusals.ts';

describe('a template a run could not render', () => {
  it('is invalid for an input it lacks, at the pointer of that input, and at none for any other value', () => {
    expect([
      unrenderableFor('The message', { reason: 'missing_variable', variable: 'input.owner.name', line: 3 }),
      unrenderableFor('The message', { reason: 'missing_variable', variable: 'to', line: 2 }),
    ]).toMatchObject([
      {
        _tag: 'invalid_input',
        detail: 'The definition reads input.owner.name on line 3, which the input does not have',
        issues: [
          { pointer: '/owner/name', detail: 'Line 3: it reads input.owner.name, which this input does not have' },
        ],
      },
      { _tag: 'invalid_input', issues: [{ pointer: '' }] },
    ]);
  });

  it('is invalid where its render stopped, past a bound or at a filter', () => {
    expect(unrenderableFor('The message', { reason: 'limit_exceeded', limit: 'time', line: 4 })).toMatchObject({
      detail: 'The message cannot be rendered with this input',
      issues: [
        {
          pointer: '',
          detail: 'Line 4: the render stopped here, past what a render may take, or at a filter that refused the value',
        },
      ],
    });
  });
});

describe('a run that cannot work as written', () => {
  it('is a conflict of the kind unworkable, recording where in the document', () => {
    expect(unworkable('/to', 'The party renders to nothing')).toMatchObject({
      _tag: 'conflict',
      kind: 'unworkable',
      detail: 'The party renders to nothing',
      record: { pointer: '/to' },
    });
  });
});

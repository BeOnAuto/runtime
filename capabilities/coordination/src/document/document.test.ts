import { mostInputBytes } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { definitionArgumentsOf } from './definition-arguments.ts';
import { runnableDocument } from './workflow-document.ts';

describe('the input a workflow gives run_definition', () => {
  it('may take as much as a run takes as its input, 1 MiB as JSON, and one byte more is refused', () => {
    const text = 'x'.repeat(mostInputBytes - JSON.stringify({ text: '' }).length);

    expect([
      definitionArgumentsOf({ type: 'reasoning', name: 'summarize', input: { text } }),
      definitionArgumentsOf({ type: 'reasoning', name: 'summarize', input: { text: `${text}x` } }),
    ]).toEqual([
      { type: 'reasoning', name: 'summarize', input: { text } },
      {
        kind: 'validation',
        title:
          'The input of run_definition takes 1048577 bytes as JSON, more than the 1 MiB a run takes; give a smaller input, or split the work across several runs',
      },
    ]);
  });
});

const typed = {
  document: { dsl: '1.0.3', namespace: 'test', name: 'typed', version: '1.0.0' },
  do: [
    { first: { set: { total: '${ $data.total as number }', note: 'kept', count: 2 } } },
    { second: { if: '$data.ok as boolean', set: { done: true, total: '${ $data.total }' } } },
  ],
};

const stripped = {
  expressions: {
    ' $data.total as number ': ' $data.total           ',
    '$data.ok as boolean': '$data.ok           ',
  },
};

describe('the document a run of a workflow holds', () => {
  it('holds each expression as its save stripped it, at its place, and every other value as written', () => {
    expect(runnableDocument(typed, stripped)).toEqual({
      document: typed.document,
      do: [
        { first: { set: { total: '${ $data.total           }', note: 'kept', count: 2 } } },
        { second: { if: '$data.ok           ', set: { done: true, total: '${ $data.total }' } } },
      ],
    });
  });

  it('is the document itself when its save stripped no expression', () => {
    expect(runnableDocument(typed, {})).toBe(typed);
  });
});

describe('the dollar signs of an expression a run holds', () => {
  it('are kept as written when its save stripped the expression, though a replacement pattern names them', () => {
    const source = " ($data.note as string) + '$$' + \"$&\" + '$\\'' ";
    const javascript = " ($data.note          ) + '$$' + \"$&\" + '$\\'' ";
    const document = { ...typed, do: [{ only: { set: { said: `\${${source}}` } } }] };

    expect(runnableDocument(document, { expressions: { [source]: javascript } })).toEqual({
      ...typed,
      do: [{ only: { set: { said: `\${${javascript}}` } } }],
    });
  });
});

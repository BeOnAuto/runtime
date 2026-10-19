import { describe, expect, it } from 'vitest';

import { markdownOf } from '../index.ts';
import { mostReadCharacters, quotedTemplate } from '../template.ts';

const inputSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'The month, such as April 2026' },
    draft: { type: 'string', description: 'The draft report' },
    lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } } } },
  },
};

function quoted(text: string, firstLine = 1): string {
  return markdownOf({
    title: 'q',
    opening: ['o'],
    body: [...quotedTemplate({ text, firstLine }, inputSchema)],
    sections: [],
    appendix: [],
  })
    .split('\n\n')
    .slice(2)
    .join('\n\n');
}

describe('a template quoted as its reader receives it', () => {
  it("is a block quote of the author's text, each value in brackets by its meaning and the author's emphasis kept", () => {
    expect(
      quoted(
        [
          ':wave: Draft website report for *{{ input.label }}* is ready.',
          '',
          '{{ input.draft | truncate: 200 }}',
          '',
          'Reply *in this thread* with **approve**.',
        ].join('\n'),
      ),
    ).toBe(
      [
        '> :wave: Draft website report for *\\[the month\\]* is ready.',
        '>',
        '> \\[the draft report\\]',
        '>',
        '> Reply *in this thread* with **approve**.\n',
      ].join('\n'),
    );
  });

  it("reads today's date, the time now, a loop's variable, a value it cannot read in code, and keeps its lines", () => {
    expect(
      quoted(
        'On {{ today }} at {{ now }}:\n{% for line in input.lines %}{{ line.sku }}{% endfor %}\n{{ 5 | plus: 1 }}',
      ),
    ).toBe(
      "> On \\[today's date\\] at \\[the time now\\]:\\\n> each line of input.lines as \\[sku\\]\\\n> `{{ 5 | plus: 1 }}`\n",
    );
  });

  it('reads a value whose path it computes by the last name of the path', () => {
    expect(quoted('{% assign at = 0 %}{{ input.lines[at].sku }}')).toBe('> `{% assign at = 0 %}`\\[the sku\\]\n');
  });

  it(`is nothing for an empty template, and is cut past ${mostReadCharacters} characters with the line after the quote`, () => {
    expect([
      quotedTemplate({ text: '{% comment %}nothing{% endcomment %}', firstLine: 1 }, inputSchema),
      quoted(`${'x'.repeat(99)}\n`.repeat(100), 12),
    ]).toEqual([
      [],
      `${Array.from({ length: 81 }, () => `> ${'x'.repeat(99)}`).join('\\\n')}\n\n… The rest is in the source, from line 93.\n`,
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { markdownOf, sectionOf, type OverviewBlock } from '../index.ts';
import { mostReadCharacters, readableParts, readableTemplate } from '../template.ts';

function markdownIn(blocks: readonly OverviewBlock[]): string {
  return (
    markdownOf({ title: 't', opening: ['o'], body: [], sections: [sectionOf('s', ...blocks)], appendix: [] }).split(
      '## s\n\n',
    )[1] ?? ''
  );
}

function read(text: string, firstLine = 1): string {
  return markdownIn(readableTemplate({ text, firstLine }));
}

describe('a template read as a person reads it', () => {
  it('reads the prompt of the example of the reasoning reference: its instructions apart, and its message', () => {
    const body = [
      '',
      '{% system %}Review the brief using the supplied criteria. Identify missing evidence. Do not invent facts.{% endsystem %}',
      'Brief: {{ input.brief }}',
      'Criteria: {{ input.criteria }}',
    ].join('\n');

    const { inside, outside } = readableParts({ text: body, firstLine: 14 }, 'system');

    expect([markdownIn(inside), markdownIn(outside)]).toEqual([
      'Review the brief using the supplied criteria. Identify missing evidence. Do not invent facts.\n',
      'Brief: **brief**\nCriteria: **criteria**\n',
    ]);
  });

  it('writes each value the template reads as the last name of its path, in bold, without its filters', () => {
    expect(
      read(
        [
          '{{ input.brief }} {{ brief }} {{ today }} {{ input.customer.name | upcase | truncate: 10 }}',
          '{{ input.nickname | default: "friend" }} {{ input.account | json }} {{ input["full name"] }}',
          '{{ input.items[0] }} {{ input.items[0].sku }} {{ input.notes | clip: 200 }}',
        ].join('\n'),
      ),
    ).toBe(
      [
        '**brief** **brief** **today** **name**',
        '**nickname** **account** **full name**',
        '**items** **sku** **notes**',
        '',
      ].join('\n'),
    );
  });
});

describe('an output that reads no value', () => {
  it('is kept as it is written, in a code span', () => {
    expect(read('{{ 364028 | money }} and {{ "text" }} and {{ true }}')).toBe(
      '`{{ 364028 | money }}` and `{{ "text" }}` and `{{ true }}`\n',
    );
  });

  it('writes a condition, its alternatives and a loop that span lines as italic lines of their own, and the end of each as the end of its paragraph', () => {
    expect(
      read(
        [
          'Dear customer,',
          '{% if input.vip %}Treat this customer as a VIP.',
          '{% elsif input.score  >  3 %}Be warm.{% else %}Be kind.{% endif %} Thank them.',
          `{% for item in input.items${' '.repeat(5000)}limit: 3 %}- {{ item.name }}`,
          '{% endfor %}',
        ].join('\n'),
      ),
    ).toBe(
      [
        'Dear customer,',
        '*When input.vip:*',
        'Treat this customer as a VIP.',
        '*Or when input.score \\> 3:*',
        'Be warm.',
        '*Otherwise:*',
        'Be kind.',
        'Thank them.',
        '*For each item of input.items limit: 3:*',
        '- **name**\n',
      ].join('\n\n'),
    );
  });
});

describe('an unless block that spans lines', () => {
  it('is an italic line of its own, its else the other case, and its end the end of its paragraph', () => {
    expect(
      read(
        ['{% unless input.quiet   or input.away %}Speak up.', '{% else %}Write.{% endunless %} Then listen.'].join(
          '\n',
        ),
      ),
    ).toBe(
      ['*Unless input.quiet or input.away:*', 'Speak up.', '*Otherwise:*', 'Write.', 'Then listen.\n'].join('\n\n'),
    );
  });
});

describe('the other tags of a template', () => {
  it('leave comments out, keep the text of a raw block, and any other tag as it is in a code span', () => {
    expect(
      read(
        [
          'Before{% comment %} a note, {{ input.secret }} {% if x %} {% endcomment %} after.',
          '{% # an inline note %}{% raw %}{{ written as is }}{% endraw %}',
          '{% assign n = input.notes | words %}{% capture note %}Speak.{% endcapture %}',
          '{% case input.tone %}{% when "warm" %}Smile.{% endcase %}{% for item %}{% break %}',
        ].join('\n'),
      ),
    ).toBe(
      [
        'Before after.',
        '{{ written as is }}',
        '`{% assign n = input.notes | words %}``{% capture note %}`Speak.',
        '`{% case input.tone %}``{% when "warm" %}`Smile.`{% for item %}``{% break %}`',
        '',
      ].join('\n'),
    );
  });

  it('keeps the paragraphs and lists of the author, and drops the whitespace a tag trims', () => {
    expect(
      read(
        [
          '# Goal',
          '',
          'Write three sentences.',
          '',
          '',
          '- one',
          '- two',
          '{%- if x -%}',
          '  Then.',
          '{%- endif %}',
        ].join('\n'),
      ),
    ).toBe('# Goal\n\nWrite three sentences.\n\n- one\n- two\n\n*When x:*\n\nThen.\n');
  });
});

describe('the parts of a template', () => {
  it('are nothing for an empty template, and nothing apart when no block is apart', () => {
    expect(readableParts({ text: '  \n\n', firstLine: 1 }, 'system')).toEqual({ inside: [], outside: [] });
    expect(readableParts({ text: 'Hello', firstLine: 1 }, 'system').inside).toEqual([]);
  });

  it('read the parts outside the block apart before and after it as one', () => {
    const { inside, outside } = readableParts(
      {
        text: 'First.{% comment %}{% system %}{% endcomment %}\n\n{% system %}Be brief.{% endsystem %}\n\nLast.',
        firstLine: 1,
      },
      'system',
    );

    expect([markdownIn(inside), markdownIn(outside)]).toEqual(['Be brief.\n', 'First.\n\nLast.\n']);
  });
});

describe(`a template past ${mostReadCharacters} characters`, () => {
  const line = `${'x'.repeat(99)}\n`;

  it('is cut at the last line that fits, with a line saying where it goes on in the source', () => {
    const text = line.repeat(100);
    const written = read(text, 10);

    expect(written.endsWith(`${'x'.repeat(99)}\n\n… The rest is in the source, from line ${10 + 81}.\n`)).toBe(true);
    expect(written.split('\n').filter((each) => each === 'x'.repeat(99))).toHaveLength(81);
  });

  it('is cut at the last space that fits on a long line, and at a whole character on a line without one', () => {
    const words = 'word '.repeat(2000);

    expect(
      read(words).endsWith(`${'word '.repeat(1637).trimEnd()}\n\n… The rest is in the source, from line 1.\n`),
    ).toBe(true);
    expect(read('x'.repeat(mostReadCharacters + 5))).toBe(
      `${'x'.repeat(mostReadCharacters)}\n\n… The rest is in the source, from line 1.\n`,
    );
  });

  it('counts a character outside the Basic Multilingual Plane once, as a person reads it, and never cuts it apart', () => {
    const emoji = `${'x'.repeat(mostReadCharacters - 1)}😀😀 and on`;

    expect(read(emoji)).toBe(`${'x'.repeat(mostReadCharacters - 1)}😀\n\n… The rest is in the source, from line 1.\n`);
    expect(read('😀'.repeat(mostReadCharacters))).toBe(`${'😀'.repeat(mostReadCharacters)}\n`);
  });

  it('is cut before a tag or an output that would pass the bound', () => {
    const text = `${line.repeat(81)}${'y'.repeat(80)}{{ input.brief }}\nmore`;

    expect(read(text, 3)).toMatch(/y{80}\n\n… The rest is in the source, from line 84\.\n$/u);
    expect(read(`${line.repeat(81)}${'y'.repeat(91)}`).endsWith(`${'y'.repeat(91)}\n`)).toBe(true);
  });

  it('counts each part of the template apart against the bound', () => {
    const { inside, outside } = readableParts(
      { text: `{% system %}${line.repeat(100)}{% endsystem %}Short.`, firstLine: 1 },
      'system',
    );

    expect(markdownIn(inside)).toMatch(/… The rest is in the source, from line 82\.\n$/u);
    expect(markdownIn(outside)).toBe('Short.\n');
  });
});

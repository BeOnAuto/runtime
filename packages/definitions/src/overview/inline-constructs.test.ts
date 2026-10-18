import { describe, expect, it } from 'vitest';

import { markdownOf, sectionOf } from '../index.ts';
import { readableTemplate } from '../template.ts';

function read(...lines: readonly string[]): string {
  const blocks = readableTemplate({ text: lines.join('\n'), firstLine: 1 });
  return (
    markdownOf({ title: 't', opening: ['o'], body: [], sections: [sectionOf('s', ...blocks)], appendix: [] }).split(
      '## s\n\n',
    )[1] ?? ''
  );
}

function loopSeparatedBy(spelling: string, separator: string, end: string): string {
  return read(`{% for item in input.items %}{{ item.name }}{% ${spelling} %}${separator}{% ${end} %}{% endfor %}`);
}

describe('a loop that opens and closes within one line', () => {
  it('is a phrase of its line, each item of its list as what it writes, as the brief of the prediction reference lists its features', () => {
    expect(
      read(
        'Predict two weeks ahead. The features are',
        '{% for feature in dataset.features %}{{ feature.name }} ({{ feature.as }}){% unless forloop.last %}, {% endunless %}{% endfor %}.',
      ),
    ).toBe(
      'Predict two weeks ahead. The features are\neach feature of dataset.features as **name** (**as**), separated by commas.\n',
    );
  });

  it('reads without a separator, its else as the other case, and nothing written as nothing', () => {
    expect(read('Items: {% for item in input.items %}{{ item.name }} {% endfor %}then.')).toBe(
      'Items: each item of input.items as **name** then.\n',
    );
    expect(read('{% for item in input.items %}{{ item.name }}{% else %}none{% endfor %}')).toBe(
      'each item of input.items as **name**, otherwise none\n',
    );
    expect(read('{% for item in input.items %}{% endfor %}')).toBe('each item of input.items as nothing\n');
  });

  it('reads a condition it ends with as a condition when it is not all but the last, or when it has an else', () => {
    expect(read('{% for item in input.items %}{{ item.name }}{% if item.new %} (new){% endif %}{% endfor %}')).toBe(
      'each item of input.items as **name** (new) when item.new\n',
    );
    expect(loopSeparatedBy('unless forloop.last', ', {% else %}.', 'endunless')).toBe(
      'each item of input.items as **name**, unless forloop.last, otherwise .\n',
    );
  });
});

describe('what separates the items of a loop within one line', () => {
  it('says in words what separates its items, in each spelling of all but the last', () => {
    expect([
      loopSeparatedBy('unless forloop.last', ', ', 'endunless'),
      loopSeparatedBy('if forloop.last == false', '; ', 'endif'),
      loopSeparatedBy('if forloop.index   <   forloop.length', ' and ', 'endif'),
      loopSeparatedBy('unless forloop.last', ' / ', 'endunless'),
      loopSeparatedBy('unless forloop.last', '\n', 'endunless'),
    ]).toEqual([
      'each item of input.items as **name**, separated by commas\n',
      'each item of input.items as **name**, separated by semicolons\n',
      'each item of input.items as **name**, separated by and\n',
      'each item of input.items as **name**, separated by slashes\n',
      'each item of input.items as **name**, separated by a line each\n',
    ]);
  });

  it('quotes any other separator in a code span, trimmed, and says nothing of one that is only space', () => {
    expect([
      loopSeparatedBy('unless forloop.last', ' | ', 'endunless'),
      loopSeparatedBy('unless forloop.last', '{{ input.joiner }}', 'endunless'),
      loopSeparatedBy('unless forloop.last', ' ', 'endunless'),
    ]).toEqual([
      'each item of input.items as **name**, separated by `|`\n',
      'each item of input.items as **name**, separated by `{{ input.joiner }}`\n',
      'each item of input.items as **name**\n',
    ]);
  });
});

describe('a condition that opens and closes within one line', () => {
  it('is a phrase of its line, what it writes when its condition holds, with the condition as written', () => {
    expect(read('Hello{% if input.vip %} dear{% endif %}, welcome.')).toBe('Hello dear when input.vip, welcome.\n');
    expect(read('{% unless input.quiet   or input.away %}Speak up.{% endunless %} Then listen.')).toBe(
      'Speak up unless input.quiet or input.away. Then listen.\n',
    );
  });

  it('reads its else as the other case, each elsif as a case of its own, and a case that writes nothing as nothing', () => {
    expect(read('{% if input.vip %}Dear {% else %}Hello {% endif %}{{ input.name }}')).toBe(
      'Dear when input.vip, otherwise Hello **name**\n',
    );
    expect(read('{% if input.score > 7 %}glad{% elsif input.score > 3 %}fine{% else %}sorry{% endif %}')).toBe(
      'glad when input.score \\> 7, fine when input.score \\> 3, otherwise sorry\n',
    );
    expect(read('{% unless input.quiet %}Speak.{% elsif input.urgent %}Whisper.{% else %}Wait.{% endunless %}')).toBe(
      'Speak unless input.quiet, Whisper when input.urgent, otherwise Wait.\n',
    );
    expect(read('{% if input.vip %}{% else %}Hi.{% endif %}')).toBe('nothing when input.vip, otherwise Hi.\n');
  });

  it('ends the whole phrase with the full stop, question or exclamation mark that ends what a case writes', () => {
    expect(read('{% if input.vip %}Treat them as a VIP. {% endif %}Hello {{ name }}.')).toBe(
      'Treat them as a VIP when input.vip. Hello **name**.\n',
    );
    expect(read('{% if input.vip %}Treat them as a VIP.{% else %}treat them as a guest.{% endif %}')).toBe(
      'Treat them as a VIP when input.vip, otherwise treat them as a guest.\n',
    );
    expect(read('{% unless input.quiet %}Say "hello."{% endunless %} Then wait.')).toBe(
      'Say "hello" unless input.quiet. Then wait.\n',
    );
    expect(read('{% if input.urgent %}Call now!{% elsif input.late %}Write (soon?){% else %}wait.{% endif %}')).toBe(
      'Call now when input.urgent, Write (soon) when input.late, otherwise wait.\n',
    );
    expect(read('{% if input.vip %}Hello {{ input.name }}.{% endif %} {% if input.new %}!{% endif %}')).toBe(
      'Hello **name** when input.vip. ! when input.new\n',
    );
  });
});

describe('constructs within one line, nested or beside others', () => {
  it('read inside out when one is nested in another', () => {
    expect(
      read(
        'Say {% for item in input.items %}{% if item.new %}{{ item.name }} (new){% else %}{{ item.name }}{% endif %}{% unless forloop.last %}; {% endunless %}{% endfor %}.',
        '{% if input.vip %}{% if input.late %}Sorry{% else %}Hello{% endif %}, friend{% endif %}.',
      ),
    ).toBe(
      [
        'Say each item of input.items as **name** (new) when item.new, otherwise **name**, separated by semicolons.',
        'Sorry when input.late, otherwise Hello, friend when input.vip.',
        '',
      ].join('\n'),
    );
  });

  it('are phrases of their lines beside a construct that spans lines, which reads as lines and paragraphs', () => {
    expect(
      read(
        'Hello{% if input.vip %} friend{% endif %}.',
        '{% for item in input.items %}',
        '- {{ item.name }}{% unless forloop.last %};{% endunless %}',
        '{% endfor %}',
        '{% if input.signed %}Signed.{% endif %}',
      ),
    ).toBe(
      [
        'Hello friend when input.vip.',
        '*For each item of input.items:*',
        '- **name**; unless forloop.last',
        'Signed when input.signed.\n',
      ].join('\n\n'),
    );
  });
});

describe('the tags inside a construct within one line', () => {
  it('keep each tag the reader does not know as it is in a code span, and the else of a case to its case', () => {
    expect(
      read(
        '{% if input.vip %}{% assign n = 1 %}{% raw %}{{ n }}{% endraw %}{% case input.tone %}{% when "warm" %}Smile.{% else %}Nod.{% endcase %}{% endif %}',
      ),
    ).toBe(
      '`{% assign n = 1 %}`{{ n }}`{% case input.tone %}``{% when "warm" %}`Smile.`{% else %}`Nod when input.vip.\n',
    );
  });

  it('read as lines and paragraphs when the loop does not read as one or its end is missing', () => {
    expect(read('{% for item %}x{% endfor %} y', '{% if input.vip %}Hello.')).toBe(
      '`{% for item %}`x\n\ny\n\n*When input.vip:*\n\nHello.\n',
    );
  });
});

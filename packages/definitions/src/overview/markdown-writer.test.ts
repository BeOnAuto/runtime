import { describe, expect, it } from 'vitest';

import { bulletList, markdownOf, mostOverviewBytes, mostTableRows, named, paragraph, sectionOf } from '../index.ts';
import type { FieldRow, Overview, OverviewBlock } from '../index.ts';

const utf8 = new TextEncoder();

const cutLine =
  '*The overview stops here, at the 65,536 bytes an overview may take; the whole definition is under Source.*';

function overviewWith(...blocks: readonly OverviewBlock[]): Overview {
  return {
    title: 'review-brief',
    opening: ['Reviews a campaign brief'],
    body: [],
    sections: [sectionOf('What it does', ...blocks)],
    appendix: [],
  };
}

function writtenBlocks(...blocks: readonly OverviewBlock[]): string {
  return markdownOf(overviewWith(...blocks)).split('## What it does\n\n')[1] ?? '';
}

function row(name: string): FieldRow {
  return { name, required: true, words: ['Text.'] };
}

function paragraphOf(bytes: number) {
  return paragraph('é'.repeat(bytes / 2));
}

describe('the Markdown of an overview', () => {
  it('opens with the title as the one heading of the first level, then the opening and each section under its own', () => {
    expect(
      markdownOf({
        title: 'review-brief',
        opening: ['Reviews a campaign brief'],
        body: [],
        sections: [sectionOf('What it needs', paragraph('A brief.')), sectionOf('What it produces')],
        appendix: [],
      }),
    ).toBe('# review-brief\n\nReviews a campaign brief\n\n## What it needs\n\nA brief.\n\n## What it produces\n');
  });

  it('writes the words of a paragraph as they are, a name in bold, an emphasis in italics and code in a span', () => {
    expect(
      writtenBlocks(
        paragraph('Brief: ', named('brief'), '\nCriteria: *as given*'),
        paragraph({ emphasis: 'When input.vip:' }),
        paragraph({ code: '{% assign n = input.notes | words %}' }),
      ),
    ).toBe('Brief: **brief**\nCriteria: *as given*\n\n*When input.vip:*\n\n`{% assign n = input.notes | words %}`\n');
  });

  it('escapes what would end the bold or the italics of a name, and keeps an underscore inside a word', () => {
    expect(
      writtenBlocks(
        paragraph(named('cost_cents'), ' ', named('_private*'), ' ', named('a[b]<c>`d`\\')),
        paragraph({ emphasis: ' When input.a < input.b\n and x:' }),
      ),
    ).toBe('**cost_cents** **\\_private\\*** **a\\[b\\]\\<c\\>\\`d\\`\\\\**\n\n*When input.a \\< input.b and x:*\n');
  });

  it('fences code that holds backticks with a longer run, and pads code that starts or ends with one', () => {
    expect(writtenBlocks(paragraph({ code: 'a ``b`` c' }), paragraph({ code: '`x`' }))).toBe(
      '```a ``b`` c```\n\n`` `x` ``\n',
    );
  });
});

describe('a list of an overview', () => {
  it('writes a list an item a line, each on one line', () => {
    expect(writtenBlocks(bulletList([['the tool ', named('search'), ' of ', named('graph')], ['every\ntool']]))).toBe(
      '- the tool **search** of **graph**\n- every tool\n',
    );
  });

  it('makes the line breaks of an item one space each, and keeps a long run of tabs that holds none as it is', () => {
    const tabs = '\t'.repeat(60_000);

    expect(writtenBlocks(bulletList([['every \t\r\n\t\n\n  tool\n'], [`a${tabs}b`]]))).toBe(
      `- every tool\n- a${tabs}b\n`,
    );
  });
});

describe('the table of fields of an overview', () => {
  it('has its header, and escapes in each cell what would break the row', () => {
    expect(
      writtenBlocks({
        kind: 'fields',
        rows: [
          { name: 'brief', required: true, words: ['The brief | the `text`\nas sent \\ kept. ', 'Text.'] },
          { name: 'a|b', required: false, words: [named('x|y'), ' ', { emphasis: 'p|q' }, ' ', { code: 'r|s' }] },
        ],
      }),
    ).toBe(
      [
        '| Field | Required | What it is |',
        '| --- | --- | --- |',
        '| **brief** | yes | The brief \\| the \\`text\\` as sent \\\\ kept. Text. |',
        '| **a\\|b** | no | **x\\|y** *p\\|q* `r\\|s` |',
        '',
      ].join('\n'),
    );
  });

  it('writes the rows it is given, and the count of the rest of a table its composition cut as a last row', () => {
    const rows = Array.from({ length: mostTableRows + 3 }, (_, index) => row(`field-${index}`));
    const lines = writtenBlocks({ kind: 'fields', rows: rows.slice(0, mostTableRows), more: 3 })
      .trimEnd()
      .split('\n');

    expect(lines).toHaveLength(2 + mostTableRows + 1);
    expect(lines.at(-2)).toBe(`| **field-${mostTableRows - 1}** | yes | Text. |`);
    expect(lines.at(-1)).toBe('| and 3 more |  |  |');
    expect(writtenBlocks({ kind: 'fields', rows }).trimEnd().split('\n')).toHaveLength(2 + mostTableRows + 3);
  });
});

describe('the diagram of an overview', () => {
  it('is a fenced flowchart, its ids from positions and every label quoted with its characters escaped', () => {
    expect(
      writtenBlocks({
        kind: 'diagram',
        nodes: [{ label: 'Run "review" #1' }, { label: 'A <b> & `c`' }, { label: 'Wait\n2 hours' }],
        edges: [
          { from: 0, to: 1 },
          { from: 1, to: 2, label: 'then | after' },
        ],
        groups: [
          { label: 'For each brief', nodes: [0, 1] },
          { label: 'Again', nodes: [1] },
        ],
      }),
    ).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  subgraph g1["For each brief"]',
        '    n1["Run #34;review#34; #35;1"]',
        '    n2["A #60;b#62; #38; #96;c#96;"]',
        '  end',
        '  subgraph g2["Again"]',
        '  end',
        '  n3["Wait 2 hours"]',
        '  n1 --> n2',
        '  n2 -->|"then #124; after"| n3',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('may have no groups', () => {
    expect(writtenBlocks({ kind: 'diagram', nodes: [{ label: 'Start' }], edges: [] })).toBe(
      '```mermaid\nflowchart LR\n  n1["Start"]\n```\n',
    );
  });
});

describe('a node of a diagram', () => {
  it('of the shape cylinder is drawn as a cylinder, inside a group or not', () => {
    expect(
      writtenBlocks({
        kind: 'diagram',
        nodes: [
          { label: 'The view', shape: 'cylinder' },
          { label: 'The "kept" view', shape: 'cylinder' },
        ],
        edges: [{ from: 0, to: 1 }],
        groups: [{ label: 'Kept', nodes: [1] }],
      }),
    ).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  subgraph g1["Kept"]',
        '    n2[("The #34;kept#34; view")]',
        '  end',
        '  n1[("The view")]',
        '  n1 --> n2',
        '```',
        '',
      ].join('\n'),
    );
  });
});

describe(`an overview past ${mostOverviewBytes} bytes`, () => {
  it('is cut at the boundary of a block, with one last line that says so, within the bound', () => {
    const written = markdownOf(overviewWith(...Array.from({ length: 20 }, () => paragraphOf(4000))));
    const blocks = written.trimEnd().split('\n\n');

    expect(utf8.encode(written).byteLength).toBeLessThanOrEqual(mostOverviewBytes);
    expect(blocks.at(-1)).toBe(cutLine);
    expect(blocks.slice(3, -1).every((block) => block === 'é'.repeat(2000))).toBe(true);
    expect(blocks).toHaveLength(3 + 16 + 1);
  });

  it('is whole at the bound', () => {
    const whole = markdownOf(overviewWith(paragraph('')));
    const room = mostOverviewBytes - utf8.encode(whole).byteLength;
    const exactly = markdownOf(overviewWith(paragraph('x'.repeat(room))));

    expect(utf8.encode(exactly).byteLength).toBe(mostOverviewBytes);
    expect(exactly.endsWith(`${'x'.repeat(room)}\n`)).toBe(true);
    expect(markdownOf(overviewWith(paragraph('x'.repeat(room + 1)))).endsWith('under Source.*\n')).toBe(true);
  });
});

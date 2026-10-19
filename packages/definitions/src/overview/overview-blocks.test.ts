import { describe, expect, it } from 'vitest';

import {
  listedPhrases,
  markdownOf,
  mostTableRows,
  named,
  numberedList,
  paragraph,
  plainTextOf,
  sectionOf,
  type Diagram,
  type OverviewBlock,
} from '../index.ts';
import { fieldTable } from './overview.ts';

function writtenBlock(block: OverviewBlock): string {
  return String(
    markdownOf({
      title: 'flow',
      opening: [],
      body: [],
      sections: [sectionOf('What it does', block)],
      appendix: [],
    }).split('## What it does\n\n')[1],
  );
}

const shaped: Diagram = {
  kind: 'diagram',
  nodes: [{ label: 'By a call', shape: 'terminal' }, { label: 'Choose', shape: 'decision' }, { label: 'Set' }],
  edges: [
    { from: 0, to: 1, dashed: false },
    { from: 1, to: 2, dashed: true, label: 'on error 503' },
    { from: 2, to: 0, dashed: true },
  ],
};

const nested: Diagram = {
  kind: 'diagram',
  nodes: [{ label: 'Outer' }, { label: 'Inner' }, { label: 'Deepest' }, { label: 'Apart' }],
  edges: [],
  groups: [
    { label: 'For each brief', nodes: [0] },
    { label: 'Try', nodes: [1], within: 0 },
    { label: 'In order', nodes: [2], within: 1 },
    { label: 'Ahead', nodes: [3], within: 4 },
    { label: 'Before', nodes: [], within: -1 },
  ],
};

describe('a numbered list of an overview', () => {
  it('is written an item a line, numbered from 1 in its order', () => {
    expect(
      writtenBlock(
        numberedList([
          [named('review'), ' runs\nfirst.'],
          ['Then ', { code: 'set' }, '.'],
        ]),
      ),
    ).toBe('1. **review** runs first.\n2. Then `set`.\n');
  });
});

describe('the shapes and edges of a diagram', () => {
  it('draw a decision and a terminal in their shapes, and a dashed edge with or without its label', () => {
    expect(writtenBlock(shaped)).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  n1(["By a call"])',
        '  n2{"Choose"}',
        '  n3["Set"]',
        '  n1 --> n2',
        '  n2 -.->|"on error 503"| n3',
        '  n3 -.-> n1',
        '```',
        '',
      ].join('\n'),
    );
  });
});

describe('the groups of a diagram', () => {
  it('nest a group within an earlier one it names, and keep at the top a group that names none before it', () => {
    expect(writtenBlock(nested)).toBe(
      [
        '```mermaid',
        'flowchart LR',
        '  subgraph g1["For each brief"]',
        '    n1["Outer"]',
        '    subgraph g2["Try"]',
        '      n2["Inner"]',
        '      subgraph g3["In order"]',
        '        n3["Deepest"]',
        '      end',
        '    end',
        '  end',
        '  subgraph g4["Ahead"]',
        '    n4["Apart"]',
        '  end',
        '  subgraph g5["Before"]',
        '  end',
        '```',
        '',
      ].join('\n'),
    );
  });
});

describe('a definition and a server named in an overview', () => {
  it('are written in bold, a definition by its title or by its name in words with its first letter raised', () => {
    expect(
      writtenBlock(
        paragraph(
          'It runs ',
          { definition: { type: 'computation', name: 'month-window' } },
          ', then ',
          { definition: { type: 'workflow', name: 'monthly-report', title: 'The *monthly* report' } },
          ', and posts through ',
          { server: 'chat' },
          '.',
        ),
      ),
    ).toBe('It runs **Month window**, then **The \\*monthly\\* report**, and posts through **chat**.\n');
  });

  it('write a definition readable in bold in the body and the sections, and by its name in code in the appendix', () => {
    const monthWindow = { definition: { type: 'computation', name: 'month-window', title: 'Month window' } };

    expect(
      markdownOf({
        title: 'report',
        opening: ['Reports'],
        body: [paragraph('It runs ', monthWindow, '.')],
        sections: [sectionOf('What it calls', paragraph(monthWindow))],
        appendix: [sectionOf('Calls', paragraph(monthWindow, ' and ', { server: 'chat' }))],
      }),
    ).toBe(
      [
        '# report',
        'Reports',
        'It runs **Month window**.',
        '## What it calls',
        '**Month window**',
        '## Details',
        '### Calls',
        '`month-window` and **chat**\n',
      ].join('\n\n'),
    );
  });
});

describe('phrases in plain text', () => {
  it('are each kind as it reads, a definition by its title or its readable name and a server by its name', () => {
    expect(
      plainTextOf([
        'Runs ',
        named('brief'),
        ', ',
        { emphasis: 'then' },
        ' ',
        { code: 'set' },
        ', ',
        { definition: { type: 'computation', name: 'month-window' } },
        ', ',
        { definition: { type: 'workflow', name: 'report', title: 'The report' } },
        ' through ',
        { server: 'chat' },
      ]),
    ).toBe('Runs brief, then set, Month window, The report through chat');
  });
});

describe('phrases listed in an overview', () => {
  it('join each item as English lists them, with and or with or, and keep the phrases of each', () => {
    expect([
      listedPhrases([], 'and'),
      listedPhrases([[named('a')]], 'or'),
      listedPhrases([[named('a')], ['b']], 'and'),
      listedPhrases([[named('a')], ['b', { code: 'c' }], ['d']], 'or'),
    ]).toEqual([[], [named('a')], [named('a'), ' and ', 'b'], [named('a'), ', ', 'b', { code: 'c' }, ', or ', 'd']]);
  });
});

describe('a table of fields an overview composes', () => {
  it(`keeps ${mostTableRows} rows and the count of the rest, so what a fact keeps is bounded as what is written`, () => {
    const rows = Array.from({ length: mostTableRows + 3 }, (_, index) => ({
      name: `field-${index}`,
      required: false,
      words: ['Text.'],
    }));

    expect([fieldTable(rows), fieldTable(rows.slice(0, mostTableRows))]).toEqual([
      { kind: 'fields', rows: rows.slice(0, mostTableRows), more: 3 },
      { kind: 'fields', rows: rows.slice(0, mostTableRows) },
    ]);
  });
});

describe('phrases listed in an overview whose items hold commas', () => {
  it('separate two items with a serial comma when asked and an item holds one, and three as English lists them', () => {
    const steps = [
      ['in step 3, ', named('Review')],
      ['in step 6, ', named('Review again')],
    ];

    expect([
      listedPhrases(steps, 'and', 'serial-when-items-hold-commas'),
      listedPhrases(steps, 'and'),
      listedPhrases([['a'], ['b']], 'or', 'serial-when-items-hold-commas'),
      listedPhrases([...steps, ['in step 7, ', named('Send')]], 'and', 'serial-when-items-hold-commas'),
    ]).toEqual([
      ['in step 3, ', named('Review'), ', and ', 'in step 6, ', named('Review again')],
      ['in step 3, ', named('Review'), ' and ', 'in step 6, ', named('Review again')],
      ['a', ' or ', 'b'],
      [
        'in step 3, ',
        named('Review'),
        ', ',
        'in step 6, ',
        named('Review again'),
        ', and ',
        'in step 7, ',
        named('Send'),
      ],
    ]);
  });
});

import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { parsePageDocument } from '../page/page-parsing.ts';
import { latelyShown, type ReadMoment } from '../page/page-rendering.ts';
import { pageData, pageOf } from '../testing/pages.ts';
import { standingRenderClock } from '../testing/time/stepping-clock.ts';
import { chartsDrawnAndLaidOut } from './rows-laid-out.ts';

const posts = [
  '```chart line',
  '{"period":"day","lines":[{"name":"Posts","points":[{"at":"2026-10-30","value":3}]}]}',
  '```',
];

const channels = ['```chart bars', '{"values":[{"name":"X","value":2}]}', '```'];

function rowOf(...cells: readonly (readonly string[])[]): readonly string[] {
  return [
    '::: row',
    ...cells
      .map((cell) => cell.join('\n'))
      .join('\n---\n')
      .split('\n'),
    ':::',
  ];
}

function laidOut(lines: readonly string[]): string {
  return chartsDrawnAndLaidOut(lines.join('\n'));
}

describe('a row of two to four cells', () => {
  it('keeps its lines, so that a client draws its cells side by side', () => {
    const written = [
      'Since it began, the workflow has drafted 8 posts.',
      '',
      ...rowOf(['#### Posts each day', ...posts], ['#### Posts by channel', ...channels]),
      '',
      ...rowOf(['One'], ['Two'], ['Three']),
      ':::row',
      'One',
      '---',
      'Two',
      '---',
      'Three',
      '---',
      'Four',
      ':::  ',
      'After the rows.',
    ];

    expect(laidOut(written)).toBe(written.join('\n'));
  });

  it('reads a --- or a ::: inside a fenced block as part of the block', () => {
    const written = rowOf(['```text', '---', '::: row', ':::', '```'], ['````markdown', '```', '---', '```', '````']);

    expect(laidOut(written)).toBe(written.join('\n'));
  });

  it('keeps a cell that renders empty in its place', () => {
    const written = rowOf([''], ['Two']);

    expect(laidOut(written)).toBe(written.join('\n'));
  });
});

describe('the lines a row does not take', () => {
  it('are Markdown as they are: a --- outside a row, a ::: that closes nothing, and any other ::: line', () => {
    const written = ['Above the line.', '', '---', '', ':::', '::: column', '  ::: row', '> ::: row', '- ::: row'];

    expect(laidOut(written)).toBe(written.join('\n'));
  });
});

describe('a row that breaks a rule', () => {
  it('is shown as its cells one after another, under the line that says it holds more than 4', () => {
    const written = ['Lately:', ...rowOf(['One'], ['', 'Two', ''], ['Three'], ['Four'], ['Five']), 'Done.'];

    expect(laidOut(written)).toBe(
      [
        'Lately:',
        'This row could not be laid out: it holds 5 cells, and a row holds at most 4.',
        '',
        'One',
        '',
        'Two',
        '',
        'Three',
        '',
        'Four',
        '',
        'Five',
        'Done.',
      ].join('\n'),
    );
  });

  it('says it holds 1 cell, and a row holds at least 2', () => {
    expect(laidOut(rowOf(['#### Posts each day', ...posts]))).toBe(
      [
        'This row could not be laid out: it holds 1 cell, and a row holds at least 2.',
        '',
        '#### Posts each day',
        ...posts,
      ].join('\n'),
    );
    expect(laidOut(['::: row', ':::'])).toBe(
      'This row could not be laid out: it holds 1 cell, and a row holds at least 2.',
    );
  });
});

describe('a row that is never closed, or that holds another', () => {
  it('runs to the end of the block when it is never closed', () => {
    expect(laidOut(['Lately:', '::: row', 'One', '---', '', 'Two', ''])).toBe(
      ['Lately:', 'This row could not be laid out: it is not closed by a line of :::.', '', 'One', '', 'Two'].join(
        '\n',
      ),
    );
  });

  it('shows a row it holds as cells too, since rows do not nest', () => {
    const written = [
      '::: row',
      'One',
      '---',
      ...rowOf(['Two'], ['Three']),
      '---',
      'Four',
      ':::',
      ...rowOf(['A'], ['B']),
    ];

    expect(laidOut(written)).toBe(
      [
        'This row could not be laid out: it holds another row, and rows do not nest.',
        '',
        'One',
        '',
        'Two',
        '',
        'Three',
        '',
        'Four',
        ...rowOf(['A'], ['B']),
      ].join('\n'),
    );
  });
});

const moment: ReadMoment = { today: '2026-11-01', now: '2026-11-01T09:30:00.000Z', clock: standingRenderClock };

function latelyOver(body: string, views: Schema.Json): string {
  const page = Result.getOrThrow(
    parsePageDocument(pageOf({ body: `{% lately %}\n${body}\n{% endlately %}`, data: pageData() })),
  );
  const template = Result.getOrThrow(Result.fromNullishOr(page.templates.lately, () => 'no lately'));
  const subject = { type: 'workflow', name: 'morning-social-content', description: null, version: 1 };
  return latelyShown(template, { state: 'live', views }, { declared: { by_day: 'series' }, subject }, moment);
}

describe('a row a template writes', () => {
  it('is checked as it renders, with the charts in its cells drawn first', () => {
    const body = [
      '::: row',
      '{% for name in views.by_day.names %}',
      '{{ name }}',
      '```chart line',
      'null',
      '```',
      '{% unless forloop.last %}',
      '---',
      '{% endunless %}',
      '{% endfor %}',
      ':::',
    ].join('\n');

    expect(latelyOver(body, { by_day: { names: ['One', 'Two'] } })).toBe(
      [
        '::: row',
        '',
        'One',
        'No data for this chart yet.',
        '',
        '---',
        '',
        '',
        'Two',
        'No data for this chart yet.',
        '',
        '',
        ':::',
      ].join('\n'),
    );
    expect(latelyOver(body, { by_day: { names: ['One', 'Two', 'Three', 'Four', 'Five'] } }).split('\n')[0]).toBe(
      'This row could not be laid out: it holds 5 cells, and a row holds at most 4.',
    );
  });
});

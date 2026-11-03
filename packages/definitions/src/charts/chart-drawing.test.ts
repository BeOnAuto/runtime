import { describe, expect, it } from 'vitest';

import { chartsDrawn } from './chart-drawing.ts';

function chart(info: string, data: unknown): string {
  return ['```' + info, JSON.stringify(data), '```'].join('\n');
}

const days = {
  unit: 'posts',
  period: 'day',
  lines: [
    {
      name: 'Posts',
      points: [
        { at: '2026-10-30', value: 3 },
        { at: '2026-10-31', value: 2 },
      ],
    },
  ],
};

const channels = {
  unit: 'posts',
  values: [
    { name: 'LinkedIn', value: 3, low: 2 },
    { name: 'X', value: 2 },
  ],
};

const campaigns = {
  columns: [{ name: 'Channel' }, { name: 'Spend', unit: 'cents' }, { name: 'Sign-ups' }, { name: 'Note' }],
  rows: [
    ['Search', 12_000, 40, 'best'],
    ['Social', 8000, null, null],
  ],
};

describe('a chart block of the right shape', () => {
  it('is left as it was written, among the rest of the Markdown', () => {
    const written = ['Runs:', '', chart('chart line', days), '', chart('chart bars', channels), 'Done.'].join('\n');

    expect(chartsDrawn(written)).toBe(written);
  });

  it('is left as written for a table, its needed roles taking the columns in order', () => {
    const written = [
      chart('chart scatter x=Spend y="Sign-ups" color=Channel mark=Note', campaigns),
      chart('chart bars', campaigns),
      chart('chart table', campaigns),
      chart('chart text', { text: 'All quiet.' }),
      chart('chart share', channels),
      chart('chart calendar', days),
    ].join('\n');

    expect(chartsDrawn(written)).toBe(written);
  });
});

describe('a chart block with no data yet', () => {
  it('is the one line that says so', () => {
    expect(chartsDrawn(['Runs:', '```chart line', 'null', '```'].join('\n'))).toBe(
      'Runs:\nNo data for this chart yet.',
    );
  });
});

describe('a chart block that cannot be drawn', () => {
  it('shows data of another shape as a table under the reason', () => {
    expect(chartsDrawn(chart('chart line', channels))).toBe(
      [
        'Couldn’t display this chart: a line chart requires a series; the data is categories.',
        '',
        '| name | value | low |',
        '| --- | --- | --- |',
        '| LinkedIn | 3 | 2 |',
        '| X | 2 |  |',
      ].join('\n'),
    );
  });

  it('shows a body that is not JSON, or matches no shape, as code under the reason', () => {
    expect([chartsDrawn('```chart line\n{"lines": \n```'), chartsDrawn(chart('chart line', { posts: 3 }))]).toEqual([
      ['Couldn’t display this chart: the data is not valid JSON.', '', '```', '{"lines": ', '```'].join('\n'),
      [
        'Couldn’t display this chart: the data does not match a supported format.',
        '',
        '```',
        '{"posts":3}',
        '```',
      ].join('\n'),
    ]);
  });

  it('names a kind or a role the info string a template wrote cannot take', () => {
    expect([chartsDrawn(chart('chart pie', channels)), chartsDrawn(chart('chart pie', { posts: 3 }))]).toEqual([
      expect.stringMatching(
        /^Couldn’t display this chart: specify a chart type after chart: line,.*\n\n\| name \| value/u,
      ),
      expect.stringMatching(
        /^Couldn’t display this chart: specify a chart type after chart:.*\n\n```\n\{"posts":3\}\n```$/u,
      ),
    ]);
  });

  it('shows a text it cannot draw as the text itself', () => {
    expect(chartsDrawn(chart('chart line', { text: 'All *quiet*.' }))).toBe(
      'Couldn’t display this chart: a line chart requires a series; the data is text.\n\nAll *quiet*.',
    );
  });

  it('refuses roles over data that is not a table', () => {
    expect(chartsDrawn(chart('chart bars x=name', channels))).toMatch(
      /^Couldn’t display this chart: column roles require a table; the data is categories\.\n\n\| name/u,
    );
  });
});

describe('a chart block over a table that cannot be drawn', () => {
  it('names a role whose column the table does not have, and a needed role no column is left for', () => {
    expect(chartsDrawn(chart('chart scatter x=Budget', campaigns)).split('\n')[0]).toBe(
      'Couldn’t display this chart: the table has no column named Budget for the role x.',
    );
    expect(
      chartsDrawn(
        chart('chart bubble x=Channel y=Spend', { columns: [{ name: 'Channel' }, { name: 'Spend' }], rows: [] }),
      ).split('\n')[0],
    ).toBe('Couldn’t display this chart: a bubble chart needs another column for size.');
  });

  it('names the column and the row of a cell that does not fit its role, passing over a row it does not draw', () => {
    const textAsSize = { ...campaigns, rows: [...campaigns.rows, ['Mail', 100, 4, 7]] };

    expect(chartsDrawn(chart('chart scatter x=Channel y=Spend mark=Note', textAsSize)).split('\n')[0]).toBe(
      'Couldn’t display this chart: Note, row 3, must contain text for mark.',
    );
  });

  it('holds the rules of a calendar and of a share', () => {
    const twoLines = { ...days, lines: [...days.lines, { name: 'Replies', points: [{ at: '2026-11-01', value: 1 }] }] };
    const negative = { values: [{ name: 'Refunds', value: -3 }] };

    expect(chartsDrawn(chart('chart calendar', twoLines))).toBe(
      [
        'Couldn’t display this chart: a calendar requires a series with one line and a daily period.',
        '',
        '| at | Posts | Replies |',
        '| --- | --- | --- |',
        '| 2026-10-30 | 3 |  |',
        '| 2026-10-31 | 2 |  |',
        '| 2026-11-01 |  | 1 |',
      ].join('\n'),
    );
    expect(chartsDrawn(chart('chart share', negative)).split('\n')[0]).toBe(
      'Couldn’t display this chart: a share chart requires values of 0 or more; Refunds is -3.',
    );
  });
});

describe('the roles of a chart over a table', () => {
  it('read a time, a number of at least 0, text on a line and any cell for color', () => {
    const bars = {
      columns: [{ name: 'Team' }, { name: 'From' }, { name: 'To' }, { name: 'Size' }, { name: 'Lead' }],
      rows: [
        ['Ops', '2026-10-01', '2026-Q4', 3, true],
        ['Sales', '2026-10-02T09:00:00Z', '2026', 0, null],
      ],
    };
    const late = { ...bars, rows: [['Ops', 'soon', '2026-Q4', 3, true]] };

    expect(chartsDrawn(chart('chart timeline color=Lead', bars))).toBe(chart('chart timeline color=Lead', bars));
    expect(chartsDrawn(chart('chart timeline', late)).split('\n')[0]).toBe(
      'Couldn’t display this chart: From, row 1, must contain a time for start.',
    );
    expect(chartsDrawn(chart('chart bubble x=Team y=Size size=From', bars)).split('\n')[0]).toBe(
      'Couldn’t display this chart: From, row 1, must contain a number of at least 0 for size.',
    );
    expect(
      chartsDrawn(chart('chart bubble x=Team y=Size size=Size', { ...bars, rows: [['Ops', '', '', -1, true]] })).split(
        '\n',
      )[0],
    ).toBe('Couldn’t display this chart: Size, row 1, must contain a number of at least 0 for size.');
  });
});

describe('the fences of the Markdown', () => {
  it('leave code that is not a chart, a fence never closed and a fence inside another alone', () => {
    const written = [
      '```json',
      '{"chart": true}',
      '```',
      '````',
      '```chart pie',
      '1',
      '```',
      '````',
      '```chart line',
      'null',
    ].join('\n');

    expect(chartsDrawn(written)).toBe(written);
  });
});

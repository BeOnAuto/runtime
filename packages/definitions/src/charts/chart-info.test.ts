import { describe, expect, it } from 'vitest';

import { chartInfoOf } from './chart-info.ts';

function rolesOf(info: string) {
  const reading = chartInfoOf(info);
  return 'info' in reading ? Object.fromEntries(reading.info.roles) : reading;
}

describe('the info string of a chart block', () => {
  it('names chart, a kind and its roles, a column in double quotes where it holds a space', () => {
    expect(rolesOf('chart scatter x=Spend y="Sign-ups per day" color=Channel')).toEqual({
      x: 'Spend',
      y: 'Sign-ups per day',
      color: 'Channel',
    });
    expect(rolesOf('chart line')).toEqual({});
  });

  it('is not a chart when it does not begin with chart', () => {
    expect([chartInfoOf('json'), chartInfoOf(''), chartInfoOf('charts line')]).toEqual([
      { other: true },
      { other: true },
      { other: true },
    ]);
  });

  it('is refused for a kind the table of kinds does not list, or none', () => {
    const refused = {
      refused:
        'a chart names its kind after chart, one of line, bars, stacked, share, histogram, scatter, bubble, heatmap, range, funnel, calendar, timeline, table, figure, text',
    };

    expect([chartInfoOf('chart pie'), chartInfoOf('chart')]).toEqual([refused, refused]);
  });

  it('is refused for a role its kind does not take, a role written twice, or a word that is no role', () => {
    expect([
      chartInfoOf('chart line x=at'),
      chartInfoOf('chart bars x=Channel size=Posts'),
      chartInfoOf('chart bars x=Channel x=Day'),
      chartInfoOf('chart bars Channel'),
    ]).toEqual([
      { refused: 'a line chart takes no roles; leave out the role x' },
      { refused: 'a bar chart takes the roles x, y, and color; the role size is not one of them' },
      { refused: 'the role x is written twice' },
      { refused: 'a role is written role=column, such as x=Channel; Channel is not' },
    ]);
  });
});

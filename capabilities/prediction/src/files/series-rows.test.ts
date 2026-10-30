import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { scratchDirectory } from '../testing/scratch.ts';
import { seriesRowsFrom, seriesRowsIn, seriesRowsOfStream } from './series-rows.ts';

function fileOf(lines: readonly string[]): string {
  const path = join(scratchDirectory(), 'rows.csv');
  writeFileSync(path, lines.join('\r\n'));
  return path;
}

const visits = [
  'series,period,visits,promotion',
  'north,2026-10-01,10,1',
  'south,2026-10-01,20,0',
  'north,2026-10-02,11,0',
];

describe('the rows of each series in a file of the build', () => {
  it('group the periods, the values and the features of each series in the order the file gives them', async () => {
    expect(await seriesRowsIn(fileOf(visits), { features: 1 })).toEqual([
      {
        series: 'north',
        periods: ['2026-10-01', '2026-10-02'],
        values: Float64Array.of(10, 11),
        features: Float64Array.of(1, 0),
      },
      { series: 'south', periods: ['2026-10-01'], values: Float64Array.of(20), features: Float64Array.of(0) },
    ]);
  });

  it('read an empty cell or one a row lacks as NaN, and a row with no period as an empty one', async () => {
    expect(
      await seriesRowsIn(fileOf(['series,period,visits,promotion', 'north,2026-10-01,,', 'north']), { features: 1 }),
    ).toEqual([
      {
        series: 'north',
        periods: ['2026-10-01', ''],
        values: Float64Array.of(Number.NaN, Number.NaN),
        features: Float64Array.of(Number.NaN, Number.NaN),
      },
    ]);
  });

  it('keep only the series asked, and see the period of every row', async () => {
    const seen: string[] = [];
    const kept = await seriesRowsOfStream(new Blob([visits.join('\r\n')]).stream(), {
      features: 0,
      keeps: (series) => series === 'south',
      sees: (period) => {
        seen.push(period);
      },
    });

    expect([kept.map(({ series }) => series), seen]).toEqual([['south'], ['2026-10-01', '2026-10-01', '2026-10-02']]);
  });
});

describe('the rows of a file that cannot be read whole', () => {
  it('fail on a file that breaks the grammar, in the middle of it or at its end', async () => {
    await expect(
      seriesRowsIn(fileOf(['series,period,visits', 'north,2026"-10-01,10']), { features: 0 }),
    ).rejects.toThrow(/quote stands inside a field/u);
    await expect(
      seriesRowsIn(fileOf(['series,period,visits', 'north,"2026-10-01,10']), { features: 0 }),
    ).rejects.toThrow(/A quoted field is never closed/u);
  });

  it('fail when the bytes cannot be read', async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error('The file went away'));
      },
    });

    await expect(seriesRowsFrom(() => failing, { features: 0 })).rejects.toThrow('The file went away');
  });
});

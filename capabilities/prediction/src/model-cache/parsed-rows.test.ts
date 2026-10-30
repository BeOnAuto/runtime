import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SeriesRows } from '../files/series-rows.ts';
import { parsedRows } from './parsed-rows.ts';

const north: readonly SeriesRows[] = [
  { series: 'north', periods: ['2026-10-01'], values: Float64Array.of(10), features: Float64Array.of() },
];

function counted(): { readonly parse: () => Promise<readonly SeriesRows[]>; readonly times: () => number } {
  const state = { times: 0 };
  return {
    parse: () => {
      state.times += 1;
      return Promise.resolve(north);
    },
    times: () => state.times,
  };
}

function failing(): Promise<readonly SeriesRows[]> {
  return Promise.reject(new Error('The rows went away'));
}

describe('the rows a server parsed for the builds it scores', () => {
  it('are parsed once for every candidate and baseline of a build, and again once more builds were scored since', async () => {
    const parsed = parsedRows(1);
    const first = counted();
    const second = counted();

    await Effect.runPromise(parsed.rowsOf('first', first.parse));
    await Effect.runPromise(parsed.rowsOf('first', first.parse));
    await Effect.runPromise(parsed.rowsOf('second', second.parse));
    const again = await Effect.runPromise(parsed.rowsOf('first', first.parse));

    expect([first.times(), second.times(), again]).toEqual([2, 1, north]);
  });

  it('are parsed again once the build that read them let them go', async () => {
    const parsed = parsedRows(2);
    const rows = counted();

    await Effect.runPromise(parsed.rowsOf('rows', rows.parse));
    await Effect.runPromise(parsed.released('rows'));
    await Effect.runPromise(parsed.rowsOf('rows', rows.parse));

    expect(rows.times()).toBe(2);
  });

  it('are parsed again after a parse that failed', async () => {
    const parsed = parsedRows(2);
    const later = counted();

    const failed = await Effect.runPromiseExit(parsed.rowsOf('rows', failing));
    await Effect.runPromise(parsed.rowsOf('rows', later.parse));

    expect([Exit.hasDies(failed), later.times()]).toEqual([true, 1]);
  });
});

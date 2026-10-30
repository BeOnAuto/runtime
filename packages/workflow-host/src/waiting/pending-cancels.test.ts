import { describe, expect, it } from 'vitest';

import { onSQLite } from '../testing/host-files.ts';
import { resumedWith } from '../waiting-testing/resumed-cancels.ts';

describe('the cancels the follower passed over, given at the first resume after a host takes the workflows', () => {
  it('are each given to its run, cleared once the run took it or had ended, and kept for a run not started', async () => {
    const resumed = await resumedWith(onSQLite, ['acme/alpha/applied', 'acme/alpha/ended', 'acme/alpha/not-started']);

    await resumed.resume();
    await resumed.resume();

    expect([...resumed.given()].toSorted()).toEqual([
      'acme/alpha/applied',
      'acme/alpha/ended',
      'acme/alpha/not-started',
    ]);
    expect(await resumed.pending()).toEqual(['acme/alpha/not-started']);
    expect(resumed.troubles()).toEqual([]);
  });

  it('report a run that could not take its cancel without holding the others, and give it again next', async () => {
    const resumed = await resumedWith(onSQLite, ['acme/alpha/applied', 'acme/alpha/failing']);

    await resumed.resume();
    const keptAfterTheFailure = await resumed.pending();
    resumed.failingNoMore();
    await resumed.resume();
    await resumed.resume();

    expect(keptAfterTheFailure).toEqual(['acme/alpha/failing']);
    expect(resumed.troubles()).toEqual([
      'The cancel asked of acme/alpha/failing could not be given; the next sweep gives it again',
    ]);
    expect(resumed.given().slice(0, 2).toSorted()).toEqual(['acme/alpha/applied', 'acme/alpha/failing']);
    expect(resumed.given().slice(2)).toEqual(['acme/alpha/failing']);
    expect(await resumed.pending()).toEqual([]);
  });
});

describe('the read of the cancels the follower passed over', () => {
  it('goes page after page, a hundred at a time, and again at the next resume when it failed', async () => {
    const runKeys = Array.from({ length: 205 }, (_, index) => `acme/alpha/run-${String(index).padStart(3, '0')}`);
    const resumed = await resumedWith(onSQLite, runKeys);

    resumed.database.failing(true);
    await resumed.resume();
    const givenWhileFailing = resumed.given().length;
    resumed.database.failing(false);
    await resumed.resume();
    await resumed.resume();

    expect(givenWhileFailing).toBe(0);
    expect(resumed.troubles()).toEqual([
      'The cancels the follower passed over could not be read; the next sweep reads them again',
    ]);
    expect([...resumed.given()].toSorted()).toEqual(runKeys);
    expect(await resumed.pending()).toEqual([]);
  });
});

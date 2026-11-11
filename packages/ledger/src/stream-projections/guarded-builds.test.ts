import { circuitBreakers } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { guardedBuild } from './guarded-builds.ts';
import type { Kept } from './guarded-builds.ts';

const place = { projection: 'labelled', prefix: 'playbook/acme/alpha/' };

const disagreed: readonly Kept[] = [{ kept: 'disagreed', projection: 'labelled', playbook: 'playbook/acme/alpha' }];

const hourMs = 3_600_000;

describe('the build of a read model, guarded by a circuit breaker per read model and playbook', () => {
  it('opens on a disagreement, refuses without building for an hour, then tries one build again and closes', async () => {
    const breakers = circuitBreakers(hourMs);
    const builds: boolean[] = [];
    const build = (outcome: readonly Kept[]) => (again: boolean) => {
      builds.push(again);
      return Promise.resolve(outcome);
    };

    const kept = [
      await guardedBuild(breakers, place, 0, build(disagreed)),
      await guardedBuild(breakers, place, hourMs - 1, build([])),
      await guardedBuild(breakers, place, hourMs, build(disagreed)),
      await guardedBuild(breakers, place, hourMs + 1, build([])),
      await guardedBuild(breakers, place, 2 * hourMs + 1, build([])),
      await guardedBuild(breakers, place, 2 * hourMs + 2, build([])),
    ];

    expect(kept.map((each) => each.map(({ kept: what }) => what))).toEqual([
      ['disagreed'],
      ['refused'],
      ['disagreed'],
      ['refused'],
      [],
      [],
    ]);
    expect(builds).toEqual([false, true, true, false]);
  });
});

describe('the one trial a half-open breaker admits', () => {
  it('is the only build until another hour has passed, even when the trial throws', async () => {
    const breakers = circuitBreakers(hourMs);
    const builds: boolean[] = [];
    const throwing = (again: boolean) => {
      builds.push(again);
      return Promise.reject(new Error('The disk failed'));
    };
    const quiet = (again: boolean) => {
      builds.push(again);
      return Promise.resolve([]);
    };
    await guardedBuild(breakers, place, 0, () => Promise.resolve(disagreed));

    const trial = guardedBuild(breakers, place, hourMs, throwing);
    await expect(trial).rejects.toThrow('The disk failed');
    const afterTheTrial = await guardedBuild(breakers, place, hourMs + 1, quiet);

    expect([afterTheTrial.map(({ kept: what }) => what), builds]).toEqual([['refused'], [true]]);
  });
});

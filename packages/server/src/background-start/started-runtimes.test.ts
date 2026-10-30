import { describe, expect, it } from 'vitest';

import type { RunningStatus } from '../local-runtime/runtime-probe.ts';
import { Sighting } from './sighting.ts';
import { StartedRuntimes, type StartedRuntime } from './started-runtimes.ts';

const minute = 60_000;

function runtimeStarted(instance: string, startedAt: number, endedAt?: number): StartedRuntime {
  return {
    instance,
    pid: 4343,
    startedAt,
    endedAt: () => endedAt,
    signal: () => endedAt === undefined,
    ended: Promise.resolve(),
  };
}

function rememberedAt(now: number, ...runtimes: readonly StartedRuntime[]): StartedRuntimes {
  const started = new StartedRuntimes(() => now);
  for (const runtime of runtimes) {
    started.remember(runtime);
  }
  return started;
}

describe('the runtimes a relay started', () => {
  it('name one that still runs by its instance, and none that ended or that another started', () => {
    const started = rememberedAt(0, runtimeStarted('first', 0, 10), runtimeStarted('second', 20));

    expect([started.living('first'), started.living('second')?.instance, started.living()]).toEqual([
      undefined,
      'second',
      undefined,
    ]);
  });

  it('pause the starts once three ended within a minute of their start, inside ten minutes', () => {
    const endedSoon = [
      runtimeStarted('a', 0, 59_000),
      runtimeStarted('b', minute, 2 * minute),
      runtimeStarted('c', 3 * minute, 3 * minute + 1),
    ];

    expect(rememberedAt(4 * minute, ...endedSoon).pausing()).toBe(true);
    expect(rememberedAt(4 * minute, ...endedSoon.slice(1)).pausing()).toBe(false);
  });

  it('do not pause for runtimes that ran longer than a minute, that still run, or that ended over ten minutes ago', () => {
    const ranLong = runtimeStarted('a', 0, 2 * minute);
    const stillRunning = runtimeStarted('b', minute);
    const long = [runtimeStarted('c', 0, 1), runtimeStarted('d', 0, 1)];

    expect(rememberedAt(3 * minute, ranLong, stillRunning, ...long).pausing()).toBe(false);
    expect(rememberedAt(11 * minute, runtimeStarted('e', 0, 1), ...long).pausing()).toBe(false);
  });
});

const statusWithoutAnInstance: RunningStatus = {
  version: '0.9.1',
  pid: 4242,
  started_at: '2026-10-14T09:41:07.000Z',
  started_by: 'agent',
  directory: '/home/someone/.auto-runtime',
  runs_in_flight: 0,
};

const firstStatus: RunningStatus = { ...statusWithoutAnInstance, instance: 'first' };

describe('the last runtime a relay saw on the port', () => {
  it('is the one that answered last, and none once anything else answers', () => {
    const sighting = new Sighting(() => false);

    sighting.saw({ state: 'running', status: firstStatus });
    const running = sighting.last();
    sighting.saw({ state: 'down' });

    expect([running, sighting.last()]).toEqual([{ instance: 'first', pid: 4242, startedBy: 'agent' }, undefined]);
  });

  it('is forgotten once the runtime the relay started with that instance ended, and kept while it runs', () => {
    const started = rememberedAt(0, runtimeStarted('first', 0, 10), runtimeStarted('second', 20));
    const sighting = new Sighting((instance) => started.ended(instance));

    sighting.saw({ state: 'running', status: { ...firstStatus, instance: 'second' } });
    const running = sighting.last();
    sighting.saw({ state: 'running', status: firstStatus });

    expect([running, sighting.last(), sighting.last()]).toEqual([
      { instance: 'second', pid: 4242, startedBy: 'agent' },
      undefined,
      undefined,
    ]);
  });

  it('is kept for a runtime with no instance, which no start of this relay can be', () => {
    const sighting = new Sighting(() => true);

    sighting.saw({ state: 'running', status: statusWithoutAnInstance });

    expect(sighting.last()).toEqual({ instance: undefined, pid: 4242, startedBy: 'agent' });
  });
});

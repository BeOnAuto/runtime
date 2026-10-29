import { describe, expect, it } from 'vitest';

import type { LatestAppends, FactScope, RecordedPoint } from '../event-store.ts';
import { streamSignalOf } from '../signal/append-signal.ts';
import { appendWatchOf, inScope, isLater } from './append-watch.ts';

const alpha: FactScope = { kind: 'playbook', playbookKey: 'playbook/acme/alpha/' };

const registries: FactScope = { kind: 'streams', streams: ['org/acme/playbooks', 'org/acme/keys/a/b'] };

const neverAborted = new AbortController().signal;

interface Reads {
  readonly asked: (RecordedPoint | undefined)[];
  readonly read: (after: RecordedPoint | undefined) => Promise<LatestAppends>;
}

function appendedAt(...latest: readonly (readonly [string, RecordedPoint])[]): LatestAppends {
  return { streams: latest.map(([stream]) => stream), latest: new Map(latest), through: ['9'], more: false };
}

function reading(...answers: readonly LatestAppends[]): Reads {
  const asked: (RecordedPoint | undefined)[] = [];
  return {
    asked,
    read: (after) => {
      asked.push(after);
      return Promise.resolve(answers[asked.length - 1] ?? appendedAt());
    },
  };
}

function readingHeldFirst(held: Promise<LatestAppends>): Reads {
  const asked: (RecordedPoint | undefined)[] = [];
  const answers = [held];
  return {
    asked,
    read: (after) => {
      asked.push(after);
      return answers.shift() ?? Promise.resolve(appendedAt());
    },
  };
}

function failingTwiceThen(answer: LatestAppends): () => Promise<LatestAppends> {
  const reads = { made: 0 };
  return () => {
    reads.made += 1;
    return reads.made <= 2
      ? Promise.reject(new Error(`The database is gone, read ${reads.made}`))
      : Promise.resolve(answer);
  };
}

function settledWithin(promise: Promise<unknown>, ms: number): Promise<string> {
  const waiting = new Promise<string>((resolve) => {
    setTimeout(() => {
      resolve('waiting');
    }, ms);
  });
  return Promise.race([promise.then(String, String), waiting]);
}

describe('the order of the points of a ledger', () => {
  it('compares each part as a whole number, the first that differs deciding', () => {
    expect([
      isLater(['10'], ['9']),
      isLater(['9'], ['10']),
      isLater(['9'], ['9']),
      isLater(['7', '1'], ['6', '900']),
      isLater(['6', '900'], ['7', '1']),
      isLater(['18446744073709551615', '0'], ['18446744073709551614', '9']),
    ]).toEqual([true, false, false, true, false, true]);
  });
});

describe('the scope of a wait', () => {
  it('takes the kinds of a playbook for a playbook, and the streams it names or the kinds that hold them for named streams', () => {
    expect([
      inScope(alpha, 'playbook/acme/alpha/runs/'),
      inScope(alpha, 'playbook/acme/alpha/runs/r1'),
      inScope(alpha, 'playbook/acme/alphabet/runs/'),
      inScope(registries, 'org/acme/playbooks'),
      inScope(registries, 'org/acme/keys/a/'),
      inScope(registries, 'org/acme/playbooks/'),
      inScope(registries, 'org/acme/connections'),
    ]).toEqual([true, true, false, true, true, false, false]);
  });
});

describe('a watch of the appends to a store, woken by what it reads', () => {
  it('ends a wait once a read names an append to its scope after its point, and no other', async () => {
    const { read, asked } = reading(
      appendedAt(['playbook/acme/beta/runs/', ['8']]),
      appendedAt(['playbook/acme/alpha/runs/', ['3']]),
      appendedAt(['playbook/acme/alpha/runs/', ['8']]),
    );
    const appended = streamSignalOf();
    const watch = appendWatchOf(read, { appended }, 60_000);

    const waited = watch.waitForAppend(alpha, ['5'], neverAborted);
    const first = await settledWithin(waited, 20);
    appended.raise('playbook/acme/alpha/runs/r1');
    const second = await settledWithin(waited, 20);
    appended.raise('playbook/acme/alpha/runs/r1');
    const third = await settledWithin(waited, 20);
    watch.endWaits();

    expect([first, second, third]).toEqual(['waiting', 'waiting', 'appended']);
    expect(asked).toEqual([['5'], ['9'], ['9']]);
  });

  it('reads on while more is to read, and from the earliest point a new wait asks after', async () => {
    const { read, asked } = reading(
      { ...appendedAt(), through: ['20'], more: true },
      appendedAt(['org/acme/playbooks', ['21']]),
    );
    const watch = appendWatchOf(read, { appended: streamSignalOf() }, 60_000);

    const later = watch.waitForAppend(registries, ['30'], neverAborted);
    const earlier = watch.waitForAppend(registries, ['10'], neverAborted);

    expect([await settledWithin(earlier, 50), await settledWithin(later, 20)]).toEqual(['appended', 'waiting']);
    expect(asked.slice(0, 2)).toEqual([['30'], ['10']]);
    watch.endWaits();
    expect(await settledWithin(later, 20)).toBe('ended');
  });
});

describe('a watch of the appends to a store, as it goes on', () => {
  it('reads on from where it read up to for a wait that asks after a later point', async () => {
    const { read, asked } = reading();
    const watch = appendWatchOf(read, { appended: streamSignalOf() }, 60_000);

    await settledWithin(watch.waitForAppend(alpha, ['5'], neverAborted), 20);
    await settledWithin(watch.waitForAppend(alpha, ['30'], neverAborted), 20);
    watch.endWaits();

    expect(asked).toEqual([['5'], ['9']]);
  });
});

describe('a watch of the appends to a store, as it is woken', () => {
  it('reads once more for the signals heard while a read was under way, and on its clock without one', async () => {
    const held = Promise.withResolvers<LatestAppends>();
    const { read, asked } = readingHeldFirst(held.promise);
    const appended = streamSignalOf();
    const watch = appendWatchOf(read, { appended }, 30);

    const waited = watch.waitForAppend(alpha, ['1'], neverAborted);
    appended.raise('playbook/acme/alpha/runs/r1');
    appended.raise('playbook/acme/alpha/runs/r2');
    held.resolve(appendedAt());
    await settledWithin(waited, 100);
    watch.endWaits();

    expect(asked.length).toBeGreaterThanOrEqual(3);
  });

  it('reads nothing for a signal heard once its last wait has ended, and stops listening', async () => {
    const { read, asked } = reading();
    const appended = streamSignalOf();
    const watch = appendWatchOf(read, { appended }, 60_000);
    const ended = new AbortController();

    const waited = watch.waitForAppend(alpha, ['1'], ended.signal);
    await settledWithin(waited, 20);
    ended.abort();
    appended.raise('playbook/acme/alpha/runs/r1');
    await settledWithin(waited, 20);
    appended.raise('playbook/acme/alpha/runs/r2');

    expect(asked).toEqual([['1']]);
  });
});

describe('a watch of the appends to a store, as its waits end', () => {
  it('ends a wait whose signal is aborted, before or after it began, and every wait once its waits end', async () => {
    const appended = streamSignalOf();
    const quiet = appendWatchOf(reading().read, { appended }, 60_000);
    const aborted = new AbortController();
    aborted.abort();
    const later = new AbortController();

    const before = await settledWithin(quiet.waitForAppend(alpha, ['1'], aborted.signal), 20);
    const waited = quiet.waitForAppend(alpha, ['1'], later.signal);
    const held = quiet.waitForAppend(alpha, ['1'], neverAborted);
    const waiting = await settledWithin(waited, 20);
    later.abort();
    const abortedLater = await settledWithin(waited, 20);
    quiet.endWaits();

    expect([before, waiting, abortedLater, await settledWithin(held, 20)]).toEqual([
      'ended',
      'waiting',
      'ended',
      'ended',
    ]);
    expect(await settledWithin(quiet.waitForAppend(alpha, ['1'], neverAborted), 20)).toBe('ended');
  });
});

describe('a watch of the appends to a store, when a read fails', () => {
  it('tells of a read that fails once, keeps its waits, and reads again on its clock until one succeeds', async () => {
    const failures: unknown[] = [];
    const watch = appendWatchOf(
      failingTwiceThen(appendedAt(['playbook/acme/alpha/runs/', ['8']])),
      {
        appended: streamSignalOf(),
        watchFailed: (failure) => {
          failures.push(failure);
        },
      },
      20,
    );

    const waited = await settledWithin(watch.waitForAppend(alpha, ['5'], neverAborted), 500);
    watch.endWaits();

    expect([waited, failures.map(String)]).toEqual(['appended', ['Error: The database is gone, read 1']]);
  });

  it('logs a failed read in the logs of the process when it is told of no other place to tell it', async () => {
    const watch = appendWatchOf(
      () => Promise.reject(new Error('The database is gone')),
      { appended: streamSignalOf() },
      60_000,
    );

    const waited = await settledWithin(watch.waitForAppend(alpha, ['5'], neverAborted), 50);
    watch.endWaits();

    expect(waited).toBe('waiting');
  });
});

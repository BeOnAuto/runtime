import { cursorOfParts } from '@on.auto/operations';
import { Clock, Effect, Exit, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import type { AppendedFactsAsked, FactScope, LatestAppends, RecordedPoint } from '../event-store.ts';
import type { Query } from '../postgresql-reads/recorded-parts.ts';
import { streamSignalOf } from '../signal/append-signal.ts';
import { appendWatchOf, inScope, isLater } from './append-watch.ts';
import { appendedFactsReaderOf } from './appended-reader.ts';
import { postgresqlAppended } from './postgresql-appended.ts';

const alpha: FactScope = { kind: 'playbook', playbookKey: 'playbook/acme/alpha/', definitionKeys: [] };

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

const alphaAppendedReader = { kind: 'playbook', playbook: { org: 'acme', playbook: 'alpha' } } as const;

function aStoreAsked() {
  const asked: AppendedFactsAsked[] = [];
  const reader = appendedFactsReaderOf({
    definitionsIn: () => Promise.resolve([]),
    pointLength: 1,
    readAppendedFacts: (_scope, request) => {
      asked.push(request);
      return Promise.resolve({ held: true, facts: [], last: null, through: ['7'], more: false });
    },
    waitForAppend: () => Promise.resolve('ended'),
    endWaits: Function.constVoid,
  });
  return { asked, reader };
}

function refused(after: string): Promise<boolean> {
  const { reader } = aStoreAsked();
  return Effect.runPromise(
    Effect.isFailure(reader.readAppendedFacts(alphaAppendedReader, { after, most: 1, dataOf: [] })),
  );
}

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answering(...answers: readonly (readonly unknown[])[]): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text, values });
      return Promise.resolve(answers[asked.length - 1] ?? []);
    },
  };
}

function group(name: string, read: number, transaction: string, position: string) {
  return { horizon: '90', name, read, transaction, position };
}

const theHorizon = 'pg_snapshot_xip(pg_current_snapshot())';

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
  it('takes the kinds of a playbook and of every definition of its org for a playbook, and the streams it names or the kinds that hold them for named streams', () => {
    expect([
      inScope(alpha, 'playbook/acme/alpha/runs/'),
      inScope(alpha, 'playbook/acme/alpha/runs/r1'),
      inScope(alpha, 'playbook/acme/alphabet/runs/'),
      inScope(alpha, 'definition/acme/d1/definitions/workflow'),
      inScope(alpha, 'definition/globex/d1/definitions/workflow'),
      inScope(registries, 'org/acme/playbooks'),
      inScope(registries, 'org/acme/keys/a/'),
      inScope(registries, 'org/acme/playbooks/'),
      inScope(registries, 'org/acme/connections'),
    ]).toEqual([true, true, false, true, false, true, true, false, false]);
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

describe('the cursor of the facts appended to a scope', () => {
  it('is refused without a read when it is not a point and the id of a fact, or the start', async () => {
    const { asked, reader } = aStoreAsked();

    const fromTheStart = await Effect.runPromise(
      reader.readAppendedFacts(alphaAppendedReader, { after: cursorOfParts([]), most: 1, dataOf: [] }),
    );
    const refusals = await Promise.all([
      refused('not a cursor'),
      refused(cursorOfParts(['x', 'message'])),
      refused(cursorOfParts(['21', 3])),
      refused(cursorOfParts(['21', 'message', 'beyond'])),
      refused(cursorOfParts(['21'])),
    ]);

    expect(asked).toEqual([{ after: null, most: 1, dataOf: [] }]);
    expect([fromTheStart.cursor, fromTheStart.through]).toEqual([cursorOfParts([]), cursorOfParts(['7'])]);
    expect(refusals).toEqual([true, true, true, true, true]);
  });

  it('is waited after only when it is a point the ledger was read through', async () => {
    const { reader } = aStoreAsked();
    const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + 1000;

    const exits = await Promise.all([
      Effect.runPromise(Effect.exit(reader.waitForAppend(alphaAppendedReader, cursorOfParts(['7']), deadline))),
      Effect.runPromise(Effect.exit(reader.waitForAppend(alphaAppendedReader, cursorOfParts(['7', '8']), deadline))),
    ]);

    expect([Exit.isSuccess(exits[0]), Exit.hasDies(exits[1])]).toEqual([true, true]);
  });
});

describe('a read on PostgreSQL of the streams appended to after a point', () => {
  it('walks the table in transaction id then position behind the horizon, leaving out the writes it first found open in other databases, and goes on from the horizon after it read all', async () => {
    const { query, asked } = answering(
      [],
      [{ horizon: '50', name: null }],
      [{ id: '58' }],
      [group('playbook/acme/alpha/events/', 2, '60', '7'), group('org/acme/playbooks', 1, '61', '3')],
    );
    const { readAppended } = postgresqlAppended(query);

    const now = await readAppended(undefined, 100);
    const appended = await readAppended(now.through, 100);

    expect(now).toEqual({ streams: [], latest: new Map(), through: ['50', '0'], more: false });
    expect(appended).toEqual({
      streams: ['playbook/acme/alpha/events/', 'org/acme/playbooks'],
      latest: new Map([
        ['playbook/acme/alpha/events/', ['60', '7']],
        ['org/acme/playbooks', ['61', '3']],
      ]),
      through: ['90', '0'],
      more: false,
    });
    expect(asked[1]?.values).toEqual([[], '0', '0', 'emt:default', 0]);
    expect(asked[2]?.text).toContain('FROM pg_stat_activity');
    expect(asked[2]?.text).toContain('datname IS DISTINCT FROM current_database()');
    expect(asked[3]?.text).toContain('(transaction_id, global_position) > ($2::xid8, $3::bigint)');
    expect(asked[3]?.text).toContain('AND transaction_id < (SELECT below FROM horizon)');
    expect(asked[3]?.text).toContain('ORDER BY transaction_id, global_position');
    expect(asked[3]?.text).toContain(theHorizon);
    expect(asked[3]?.text).toContain('% 4294967296 <> ALL($1::bigint[])');
    expect(asked[3]?.values).toEqual([['58'], '50', '0', 'emt:default', 100]);
  });

  it('goes on after the last message it read when it read as many as it was asked', async () => {
    const { query } = answering(
      [],
      [group('playbook/acme/alpha/events/', 1, '60', '7'), group('playbook/acme/beta/events/', 2, '61', '3')],
      [],
      [group('playbook/acme/alpha/events/', 2, '61', '9'), group('playbook/acme/beta/events/', 1, '61', '4')],
    );
    const { readAppended } = postgresqlAppended(query);

    const across = await readAppended(['50', '0'], 3);
    const within = await readAppended(['50', '0'], 3);

    expect([across.through, across.more]).toEqual([['61', '3'], true]);
    expect([within.through, within.more]).toEqual([['61', '9'], true]);
  });
});

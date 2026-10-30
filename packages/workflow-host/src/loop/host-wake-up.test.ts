import type { WorkflowEngine } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { fakeDueWork, type FakeDueWork } from '../due-work/fake-due-work.ts';
import { until } from '../testing/until.ts';
import type { DueTimer, TimerTable } from '../timers/sql-timers.ts';
import { steppedClock } from '../views-testing/stepped-sweeps.ts';
import { hostWakeUp, type NextWake, type Woken } from './host-wake-up.ts';

const sweepEveryMs = 1000;

interface StoredTimer {
  readonly timer: DueTimer;
  readonly dueAt: number;
  readonly fired: boolean;
}

interface FakeTimers {
  readonly table: Omit<TimerTable, 'timers'>;
  readonly armed: (timerId: string, dueAt: number) => void;
}

function fakeTimers(record: (what: string) => void, nextReadsFailing: number): FakeTimers {
  const stored = new Map<string, StoredTimer>();
  const reads = { failing: nextReadsFailing };
  const armed = () => [...stored.values()].filter(({ fired }) => !fired);
  const changed = ({ timerId }: DueTimer, change: Partial<StoredTimer>) =>
    Effect.sync(() => {
      const timer = stored.get(timerId);
      if (timer !== undefined) {
        stored.set(timerId, { ...timer, ...change });
      }
    });
  return {
    table: {
      due: (now, limit) =>
        Effect.sync(() =>
          armed()
            .filter(({ dueAt }) => dueAt <= now)
            .toSorted((one, other) => one.dueAt - other.dueAt)
            .slice(0, limit)
            .map(({ timer }) => timer),
        ),
      nextDueAt: () =>
        Effect.suspend(() => {
          record('read the next timer');
          reads.failing -= 1;
          return reads.failing < 0
            ? Effect.succeed(Math.min(...armed().map(({ dueAt }) => dueAt)))
            : Effect.die(new Error('The timers are out of reach'));
        }).pipe(Effect.map((next) => (Number.isFinite(next) ? next : null))),
      fired: (timer) => changed(timer, { fired: true }),
      postponed: (timer, dueAt) => changed(timer, { dueAt }),
    },
    armed: (timerId, dueAt) => {
      stored.set(timerId, { timer: { runKey: 'acme/alpha/run', timerId }, dueAt, fired: false });
    },
  };
}

function sweepingEngine(record: (what: string) => void, sweepFails: boolean): WorkflowEngine {
  return {
    submit: () => Effect.die(new Error('A wake-up submits only through how a timer fires')),
    wake: () => Effect.die(new Error('A wake-up wakes runs only through a sweep')),
    sweep: (before) =>
      sweepFails
        ? Effect.die(new Error('The ledger is down'))
        : Effect.sync(() => {
            record(`swept the runs due before ${before}`);
            return { runs: 0, timersArmedAgain: 0 };
          }),
  };
}

interface Waking {
  readonly wakeUp: (woken: Woken) => Promise<NextWake>;
  readonly timers: FakeTimers;
  readonly happened: () => readonly string[];
  readonly troubles: () => readonly string[];
  readonly raised: () => number;
  readonly stop: () => Promise<void>;
}

interface WakingOptions {
  readonly rows?: FakeDueWork;
  readonly firing?: (timer: DueTimer) => Effect.Effect<void, Error>;
  readonly sweepFails?: boolean;
  readonly nextReadsFailing?: number;
}

function waking(
  now: number,
  { rows, firing = () => Effect.void, sweepFails = false, nextReadsFailing = 0 }: WakingOptions = {},
): Waking {
  const happened: string[] = [];
  const troubles: string[] = [];
  const counts = { raised: 0 };
  const record = (what: string) => {
    happened.push(what);
  };
  const timers = fakeTimers(record, nextReadsFailing);
  const work = hostWakeUp(
    {
      clock: steppedClock(now),
      timers: timers.table,
      dueWork: rows === undefined ? [] : [rows.work('host')],
      engine: sweepingEngine(record, sweepFails),
      fire: (timer, at) =>
        Effect.andThen(
          firing(timer),
          Effect.sync(() => {
            record(`fired ${timer.timerId} at ${at} after ${rows?.performed().length ?? 0} rows`);
          }),
        ),
      resume: () => Effect.sync(() => happened.push('resumed the calls')),
      trouble: (what) => Effect.sync(() => troubles.push(what)),
      sweepEveryMs,
    },
    {
      raised: () => {
        counts.raised += 1;
      },
      renewed: () => {
        record('renewed the signal');
      },
    },
  );
  const stop = () => Effect.runPromise(work.stop());
  onTestFinished(stop);
  return {
    wakeUp: (woken) => Effect.runPromise(work.wakeUp(woken)),
    timers,
    happened: () => happened,
    troubles: () => troubles,
    raised: () => counts.raised,
    stop,
  };
}

describe('a wake-up of the host, firing timers', () => {
  it('fires the timers due by the moment it is woken at, at that moment, so a wake-up again at once fires none', async () => {
    const now = Date.now();
    const host = waking(now);
    host.timers.armed('late', now - 1000);
    host.timers.armed('due', now);
    host.timers.armed('later', now + 5000);

    const first = await host.wakeUp({ now, sweep: false });
    const again = await host.wakeUp({ now, sweep: false });

    expect(host.happened().filter((what) => what.startsWith('fired'))).toEqual([
      `fired late at ${now} after 0 rows`,
      `fired due at ${now} after 0 rows`,
    ]);
    expect([first, again]).toEqual([{ nextDueAt: now + 5000 }, { nextDueAt: now + 5000 }]);
  });

  it('puts off a timer that could not fire until a sweep interval after it was woken, and reports it', async () => {
    const now = Date.now();
    const host = waking(now, { firing: () => Effect.fail(new Error('The run is busy')) });
    host.timers.armed('busy', now);

    const next = await host.wakeUp({ now, sweep: false });

    expect([next, host.happened().some((what) => what.startsWith('fired')), host.troubles()]).toEqual([
      { nextDueAt: now + sweepEveryMs },
      false,
      ['A timer of a run could not fire; it fires again at the next sweep'],
    ]);
  });
});

describe('a wake-up of the host, performing due rows', () => {
  it('performs the due rows that call out nowhere before it fires the timers of the same moment', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('expiry', now - 1000);
    rows.local('expiry');
    const host = waking(now, { rows });
    host.timers.armed('due', now - 1000);

    await host.wakeUp({ now, sweep: false });

    expect([rows.performed(), host.happened().filter((what) => what.startsWith('fired'))]).toEqual([
      [{ key: 'expiry', at: now, by: 'host' }],
      [`fired due at ${now} after 1 rows`],
    ]);
  });

  it('raises the signal of its clock when a row it handed out ends after it answered', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('delivery', now - 1000);
    rows.hold();
    const host = waking(now, { rows });

    await host.wakeUp({ now, sweep: false });
    const raisedOnAnswering = host.raised();
    rows.release();
    await until(rows.performed, (performed) => performed.length === 1);

    expect([raisedOnAnswering, host.raised()]).toEqual([0, 1]);
  });

  it('ends the rows it handed out when it is stopped', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('delivery', now - 1000);
    rows.hanging('delivery');
    const host = waking(now, { rows });
    await host.wakeUp({ now, sweep: false });
    await until(rows.attempts, (made) => made.length === 1);

    await host.stop();

    expect(rows.interrupted()).toEqual(['delivery']);
  });
});

describe('a wake-up of the host, sweeping', () => {
  it('sweeps only when it is asked to: the runs overdue by a minute, then the calls to resume', async () => {
    const now = Date.now();
    const host = waking(now);

    await host.wakeUp({ now, sweep: false });
    const unasked = [...host.happened()];
    await host.wakeUp({ now, sweep: true });

    expect([unasked, host.happened().slice(unasked.length)]).toEqual([
      ['renewed the signal', 'read the next timer'],
      [`swept the runs due before ${now - 60_000}`, 'resumed the calls', 'renewed the signal', 'read the next timer'],
    ]);
  });

  it('reports a sweep that failed, and resumes no call', async () => {
    const now = Date.now();
    const host = waking(now, { sweepFails: true });

    await host.wakeUp({ now, sweep: true });

    expect([host.happened().includes('resumed the calls'), host.troubles()]).toEqual([
      false,
      ['A sweep of the runs failed; the next sweep tries again'],
    ]);
  });
});

describe('a wake-up of the host, answering when it is next due', () => {
  it('answers no time when no timer is armed and no row is due', async () => {
    const now = Date.now();
    const host = waking(now, { rows: fakeDueWork() });

    await expect(host.wakeUp({ now, sweep: false })).resolves.toEqual({ nextDueAt: null });
  });

  it.each([
    ['the next timer', 2000, 3000, 2000],
    ['the next due row', 3000, 2000, 2000],
  ])('answers the earliest of the next timer and the next due row, here %s', async (_, timerInMs, rowInMs, inMs) => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('later', now + rowInMs);
    const host = waking(now, { rows });
    host.timers.armed('later', now + timerInMs);

    await expect(host.wakeUp({ now, sweep: false })).resolves.toEqual({ nextDueAt: now + inMs });
  });

  it('answers the next due row when the next timer could not be read, and reports it', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('later', now + 3000);
    const host = waking(now, { rows, nextReadsFailing: 1 });
    host.timers.armed('later', now + 2000);

    const next = await host.wakeUp({ now, sweep: false });

    expect([next, host.troubles()]).toEqual([
      { nextDueAt: now + 3000 },
      ['The next due time of the timers could not be read; the loop waits for the next sweep'],
    ]);
  });
});

describe('a wake-up of the host, and the signal of its clock', () => {
  it('renews the signal once its round is done and before it reads when it is next due', async () => {
    const now = Date.now();
    const host = waking(now);
    host.timers.armed('due', now);

    await host.wakeUp({ now, sweep: false });

    expect(host.happened()).toEqual([`fired due at ${now} after 0 rows`, 'renewed the signal', 'read the next timer']);
  });
});

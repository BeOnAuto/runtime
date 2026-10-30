import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { skippingClock } from '../loop/host-clock.ts';
import { settleAttemptsBeforeBackingOff, settleBackOffMs } from '../settlement/settle-attempts.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = runAt(runId);

const ending = workflow('do:\n  - done: { set: { done: true } }');

const outageMs = 2 * 60_000;

describe('the host asked to start a run whose settlement is pending', () => {
  it('settles it again at once, and answers settled once it is', async () => {
    const ledger = { down: true };
    const hosted = await hostedOn(
      { store: 'sqlite', file: aSQLiteFile() },
      {
        sweepEveryMs: 3_600_000,
        ledgerDown: () => ledger.down,
      },
    );
    hosted.know(runId);

    const first = await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    const whileDown = await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    ledger.down = false;
    const once = await Effect.runPromise(hosted.host.start(run, startOf(ending)));

    expect([first, whileDown, once]).toEqual(['started', 'going', 'settled']);
    expect(hosted.settleAttempts()).toBe(3);
    expect([...hosted.settlements().keys()]).toEqual([runId]);
  });

  it('tries it again at the next sweep after a start found it backing off, rather than a minute later', async () => {
    const attemptOfTheStart = settleAttemptsBeforeBackingOff + 1;
    const attempts = { made: 0 };
    const hosted = await hostedOn(
      { store: 'sqlite', file: aSQLiteFile() },
      {
        sweepEveryMs: 20,
        ledgerDown: () => {
          attempts.made += 1;
          return attempts.made <= attemptOfTheStart;
        },
      },
    );
    hosted.know(runId);

    await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    await until(hosted.notes, (notes) => notes.length > 0);
    const startedAgain = await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    const settled = await until(hosted.settlements, (settlements) => settlements.size > 0);

    expect(startedAgain).toBe('going');
    expect([...settled.keys()]).toEqual([runId]);
    expect(hosted.settleAttempts()).toBe(attemptOfTheStart + 1);
  });
});

describe('the host whose ledger cannot be reached for two minutes', () => {
  it('backs off to once a minute, and settles the run once the ledger is back, with nothing done by hand', async () => {
    const clock = skippingClock(1_790_845_200_000);
    const outage = { endsAt: Number.POSITIVE_INFINITY };
    const hosted = await hostedOn(
      { store: 'sqlite', file: aSQLiteFile() },
      {
        clock,
        sweepEveryMs: 1000,
        ledgerDown: () => clock.now() < outage.endsAt,
      },
    );
    hosted.know(runId);
    outage.endsAt = clock.now() + outageMs;

    await Effect.runPromise(hosted.host.start(run, startOf(ending)));
    const notes = await until(hosted.notes, (noted) => noted.length > 1);

    expect(notes.map(({ kind }) => kind)).toEqual(['settle_backing_off', 'settled_after_back_off']);
    expect([...hosted.settlements().keys()]).toEqual([runId]);
    expect(hosted.settleAttempts()).toBe(settleAttemptsBeforeBackingOff + Math.ceil(outageMs / settleBackOffMs));
    expect(hosted.troubles()).toEqual([]);
  });
});

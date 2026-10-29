import type { RejectedCall } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { stateInCurrentFormat } from '../run-log/run-fold.ts';
import { snapshotChunks, snapshotFromChunks, snapshotOf } from '../run-log/snapshot.ts';
import { testFunctions, testSettings } from '../testing/driver-inputs.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import {
  calling,
  day,
  firstRefusalOf,
  minute,
  outOfCredits,
  refusalsShown,
  refusingAlways,
  refusingTheSecond,
  second,
  startsIn,
  startsOfTheSecond,
  timed,
  waitingOnASecondRefusal,
} from '../testing/refused-calls.ts';
import { drivenRun, drivenRunId, timersArmedIn, timersCancelledIn } from '../testing/run-history.ts';

describe('a call that waits for admission', () => {
  it('stops waiting when the run is cancelled, disarming its retry, and is never called again', () => {
    const driver = waitingOnASecondRefusal();
    driver.cancel(drivenRunId);
    const ended = driver.runUntilEnded(drivenRunId);
    const events = driver.ports.runStore.events(drivenRunId);
    const retry = timersArmedIn(events, 'retry_delay').map(({ timerId }) => timerId);

    expect(ended.outcome).toMatchObject({ kind: 'cancelled' });
    expect(timersCancelledIn(events)).toEqual(expect.arrayContaining(retry));
    expect(startsIn(events)).toHaveLength(2);
  });

  it('waits on, unmoved, when the run receives an event meanwhile', () => {
    const driver = waitingOnASecondRefusal();
    const before = driver.state(drivenRunId).machine.root;
    driver.deliver(drivenRunId, { id: 'event-1', type: 'com.acme.noticed' });

    expect(driver.state(drivenRunId).machine.root).toEqual(before);
    expect(startsIn(driver.ports.runStore.events(drivenRunId))).toHaveLength(2);
  });

  it('is stopped by the timeout of its task, which waiting for admission does not hold off', () => {
    const run = drivenRun(timed, { respond: refusingAlways });

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 408, instance: second } });
    expect(startsOfTheSecond(run.events)).toHaveLength(4);
  });

  it('holds no call open and no deadline of a call while it waits, and arms a fresh deadline for each try', () => {
    const driver = waitingOnASecondRefusal();
    const waiting = driver.state(drivenRunId);

    expect(waiting.calls).toEqual({});
    expect(Object.values(waiting.timers.armed).map(({ purpose }) => purpose)).toEqual(['deadline', 'retry_delay']);
    expect(timersArmedIn(driver.ports.runStore.events(drivenRunId), 'call_deadline')).toHaveLength(2);
  });

  it('is kept through a snapshot of its run, and reads back in the current format', () => {
    const waiting = waitingOnASecondRefusal().state(drivenRunId);
    const snapshot = Result.getOrThrow(snapshotFromChunks(snapshotChunks(snapshotOf(waiting, 3))));

    expect(stateInCurrentFormat(snapshot.format, snapshot.state)).toEqual(waiting);
    expect(JSON.stringify(waiting.machine.root)).toContain(
      '"body":{"kind":"admission","function":"notify","arguments":',
    );
  });
});

function shownFor(refusal: RejectedCall) {
  const run = drivenRun(calling, { respond: refusingTheSecond(1, refusal) });
  return { shown: refusalsShown(run.events)[0], refusedAt: firstRefusalOf(run) };
}

const longLink = `https://studio.example.com/${'x'.repeat(1100)}`;

function kindWords(name: string, _: unknown, { kind }: RejectedCall): string {
  return `${name} ${String(kind)}`;
}

const wordingKinds = { ...testSettings, functions: { ...testFunctions, refusal: kindWords } };

describe('a refusal shown on the step that waits', () => {
  it('cuts a long detail at 1 KiB and a long kind or because at 256 bytes', () => {
    const { shown } = shownFor({
      ...outOfCredits,
      detail: 'd'.repeat(2000),
      kind: 'k'.repeat(300),
      because: 'b'.repeat(300),
    });

    expect([shown?.detail.length, shown?.kind?.length, shown?.because?.length]).toEqual([1024, 256, 256]);
  });

  it('leaves out a link longer than 1 KiB, which would not work cut', () => {
    expect(shownFor({ ...outOfCredits, resolve_at: longLink }).shown).not.toHaveProperty('resolve_at');
  });

  it('shows when the limit lifts and why the runtime is limited, cutting the why at 256 bytes and leaving out a longer time', () => {
    const limited = { ...outOfCredits, because: 'free_daily_limit', lifts_at: '2026-10-29T00:00:00.000Z' };

    expect(shownFor({ ...limited, limited_because: 'cap' }).shown).toMatchObject({
      lifts_at: '2026-10-29T00:00:00.000Z',
      limited_because: 'cap',
    });
    expect(shownFor({ ...limited, limited_because: 'c'.repeat(300) }).shown?.limited_because?.length).toBe(256);
    expect(shownFor({ ...limited, lifts_at: 't'.repeat(300) }).shown).not.toHaveProperty('lifts_at');
  });

  it('names no kind, because or link it was not given', () => {
    const { shown, refusedAt } = shownFor({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'No',
      admission: 'refused',
    });

    expect(shown).toStrictEqual({ detail: 'No', retry_at: refusedAt + minute, until: refusedAt + day });
  });

  it('is worded by the functions’ words for a refusal once the wait ends', () => {
    const driver = memoryDriver({ sandbox: testSandbox, machine: wordingKinds, respond: refusingAlways });
    driver.start({ runId: drivenRunId, document: calling });

    expect(driver.runUntilEnded(drivenRunId).outcome).toMatchObject({
      error: { title: 'The function notify notify credits_exhausted' },
    });
  });
});

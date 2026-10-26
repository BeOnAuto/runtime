import type { SettleRun } from '@on.auto/definitions';
import { Conflict, type Settlement } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostNote } from '../host/host-reports.ts';
import { addressOfRun } from '../runs/run-address.ts';
import { runKey } from '../suite-testing/probe-subjects.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { ledgerRecordStore } from './ledger-record-store.ts';
import { settleAttemptsBeforeBackingOff, settleBackOffMs } from './settle-attempts.ts';

const settledBy = { version: 2 };

const run = { runId: runKey, attributes: {} };

const succeeded: Settlement = { status: 'succeeded', output: 'done' };

const stillRunning = new Conflict({
  detail: 'The run executes within the call that started it, so it cannot be settled',
});

const recordedRun = {
  run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  type: 'workflow',
  name: 'flow',
  definition_version: 1,
  status: 'succeeded',
  started_at: '2026-10-05T09:00:00.000Z',
  started_by: { id: 'acme-admin', name: 'acme-admin' },
} as const;

interface Recording {
  readonly recordStore: ReturnType<typeof ledgerRecordStore>;
  readonly at: (now: number) => void;
  readonly refusing: (refuses: boolean) => void;
  readonly attempts: () => number;
  readonly notes: () => readonly HostNote[];
}

async function recording(): Promise<Recording> {
  const state = { now: 0, refuses: true, attempts: 0 };
  const notes: HostNote[] = [];
  const settle: SettleRun = () =>
    Effect.suspend(() => {
      state.attempts += 1;
      return state.refuses ? Effect.fail(stillRunning) : Effect.succeed(recordedRun);
    });
  const recordStore = ledgerRecordStore(await openedOn({ store: 'sqlite', file: aSQLiteFile() }), {
    settle,
    note: (note) =>
      Effect.sync(() => {
        notes.push(note);
      }),
    now: () => state.now,
  });
  return {
    recordStore,
    at: (now) => {
      state.now = now;
    },
    refusing: (refuses) => {
      state.refuses = refuses;
    },
    attempts: () => state.attempts,
    notes: () => notes,
  };
}

function settledOnce(recorded: Recording): Promise<Result.Result<string, { readonly detail: string }>> {
  return Effect.runPromise(
    Effect.result(recorded.recordStore.settle({ runId: runKey, settlement: succeeded }, run, settledBy)),
  );
}

function refusedEveryAttemptBeforeBackingOff(recorded: Recording): Promise<readonly { readonly detail: string }[]> {
  const refused = Effect.flip(recorded.recordStore.settle({ runId: runKey, settlement: succeeded }, run, settledBy));
  return Effect.runPromise(Effect.forEach(Array.from({ length: settleAttemptsBeforeBackingOff }), () => refused));
}

const address = addressOfRun(runKey);

describe('the record store of the host, refused', () => {
  it(`tries again every dispatch, then after ${settleAttemptsBeforeBackingOff} attempts once a minute, saying so once`, async () => {
    const recorded = await recording();

    const refusals = await refusedEveryAttemptBeforeBackingOff(recorded);
    recorded.at(settleBackOffMs - 1);
    const backingOff = await settledOnce(recorded);
    recorded.at(settleBackOffMs);
    const againAMinuteLater = await settledOnce(recorded);

    expect(refusals).toHaveLength(settleAttemptsBeforeBackingOff);
    expect(backingOff).toMatchObject({
      failure: {
        detail: `The settlement failed ${settleAttemptsBeforeBackingOff} times, so it is tried again once every ${settleBackOffMs} ms`,
      },
    });
    expect(againAMinuteLater).toMatchObject({ failure: { detail: stillRunning.detail } });
    expect(recorded.attempts()).toBe(settleAttemptsBeforeBackingOff + 1);
    expect(recorded.notes()).toEqual([
      {
        kind: 'settle_backing_off',
        run: address,
        attempts: settleAttemptsBeforeBackingOff,
        detail: stillRunning.detail,
      },
    ]);
  });

  it('records the settlement once the record takes it, saying that it settled after backing off', async () => {
    const recorded = await recording();
    await refusedEveryAttemptBeforeBackingOff(recorded);
    recorded.refusing(false);
    recorded.at(settleBackOffMs);

    const settled = await settledOnce(recorded);
    const again = await settledOnce(recorded);

    expect([settled, again]).toEqual([Result.succeed('recorded'), Result.succeed('already_recorded')]);
    expect(recorded.notes().at(-1)).toEqual({
      kind: 'settled_after_back_off',
      run: address,
      attempts: settleAttemptsBeforeBackingOff + 1,
    });
  });
});

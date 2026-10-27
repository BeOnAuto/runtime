import { LedgerLog } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { DateTime, Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';

import type { MeteredLedger } from '../admission/admitting.ts';
import { meterDecider } from '../meter-stream/meter-decider.ts';
import { METER_STREAM, type MeterState } from '../meter-stream/meter-events.ts';
import type { LedgerAt } from './ledgers.ts';
import { FIRST_MOMENT } from './runs.ts';
import { capturedWarnings, failingLedger, watchedLog, type Failing } from './watched-ledger.ts';

export interface MeterRuntime {
  readonly timed: <A, E>(work: Effect.Effect<A, E, Ledger | LedgerLog>) => Promise<A>;
  readonly onTheLedger: <A, E>(work: (ledger: Ledger['Service']) => Effect.Effect<A, E>) => Promise<A>;
  readonly ledgered: Effect.Effect<MeteredLedger, never, Ledger | LedgerLog>;
  readonly state: () => Promise<MeterState>;
  readonly eventsRead: () => number;
  readonly readsFail: () => void;
  readonly executesFail: (failure: Failing) => void;
  readonly warnings: () => readonly string[];
  readonly at: (moment: string) => void;
  readonly dispose: () => Promise<void>;
}

export function meterRuntimeOn(at: LedgerAt): MeterRuntime {
  const warnings = capturedWarnings();
  const runtime = ManagedRuntime.make(Layer.mergeAll(at.layer(), TestClock.layer(), warnings.layer));
  const watched = watchedLog();
  const failing = failingLedger();
  const moment = { now: FIRST_MOMENT };
  const timed = <A, E>(work: Effect.Effect<A, E, Ledger | LedgerLog>) =>
    runtime.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment.now))).pipe(Effect.andThen(work)),
    );
  const onTheLedger = <A, E>(work: (ledger: Ledger['Service']) => Effect.Effect<A, E>) =>
    timed(Effect.flatMap(Effect.service(Ledger), work));
  return {
    timed,
    onTheLedger,
    ledgered: Effect.gen(function* () {
      return { ledger: failing.ledger(yield* Ledger), log: watched.log(yield* LedgerLog) };
    }),
    state: async () => (await onTheLedger((ledger) => ledger.load(METER_STREAM, meterDecider))).state,
    eventsRead: watched.eventsRead,
    readsFail: watched.readsFail,
    executesFail: failing.executesFail,
    warnings: warnings.lines,
    at: (when) => {
      moment.now = when;
    },
    dispose: () => runtime.dispose(),
  };
}

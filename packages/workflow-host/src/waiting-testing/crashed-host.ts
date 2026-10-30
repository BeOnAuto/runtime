import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { hostEngineOn, type HostEngine } from '../host/host-engine.ts';
import type { RunStart } from '../host/run-requests.ts';
import { systemClock } from '../loop/host-clock.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { testMachine } from '../testing/host-documents.ts';
import { recordingReports, recordingSettlements } from '../testing/recording-reports.ts';
import { executorWaitingOf } from '../waiting/waiting-parts.ts';
import { recordedWaiting } from './recorded-waiting.ts';

export function bareEngineOn(database: HostDatabase): HostEngine {
  return hostEngineOn(
    database,
    {
      machine: testMachine,
      perform: Function.constant(Effect.never),
      settle: recordingSettlements(Function.constFalse).settle,
      reports: recordingReports().reports,
      mostCallsAtOnce: 4,
      clock: systemClock,
      reactions: recordedReactions().options,
    },
    executorWaitingOf(database, testMachine, recordedWaiting().options),
    Function.constVoid,
  );
}

export async function startedByAHostThatDied(database: HostDatabase, runKey: string, start: RunStart): Promise<void> {
  await Effect.runPromise(
    bareEngineOn(database).submitted({ ...start, kind: 'started', runId: runKey, at: Date.now() }),
  );
}

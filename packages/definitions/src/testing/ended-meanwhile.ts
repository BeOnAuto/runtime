import { Effect, Logger } from 'effect';

import { runDecider } from '../runs/run-decider.ts';
import type { Harness } from './harness.ts';
import { acted, stream } from './resumed-runs.ts';

export const outputOfAnotherAttempt = 'Ended by another attempt';

const endedByAnother = {
  type: 'finish',
  result: { type: 'run_succeeded', data: { output: outputOfAnotherAttempt, record: {} } },
  ...acted,
} as const;

export function endedByAnotherOnItsLogLine({ ledger }: Pick<Harness, 'ledger'>) {
  return Logger.layer([
    Logger.make(() => {
      Effect.runSync(Effect.orDie(ledger.service.execute(stream, runDecider, endedByAnother)));
    }),
  ]);
}

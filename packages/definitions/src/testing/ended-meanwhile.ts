import { Effect, Logger } from 'effect';

import type { RunCommand } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import { fencingTokenOf, startedRunOf } from '../runs/run-state.ts';
import type { Harness } from './harness.ts';
import { acted, stepStreamIn } from './resumed-runs.ts';

export const outputOfAnotherAttempt = 'Ended by another attempt';

function endedByTheAttemptHolding(fencingToken: number): RunCommand {
  return {
    type: 'finish',
    result: { type: 'run_succeeded', data: { output: outputOfAnotherAttempt, record: {} } },
    attempt: { fencingToken, version: 1 },
    ...acted,
  };
}

export function endedByAnotherOnItsLogLine({ ledger }: Pick<Harness, 'ledger'>) {
  const ended = Effect.flatMap(ledger.service.load(stepStreamIn(ledger), runDecider), ({ state }) =>
    ledger.service.execute(
      stepStreamIn(ledger),
      runDecider,
      endedByTheAttemptHolding(fencingTokenOf(startedRunOf(state))),
    ),
  );
  return Logger.layer([
    Logger.make(() => {
      Effect.runSync(Effect.orDie(ended));
    }),
  ]);
}

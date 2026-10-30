import { Result } from 'effect';

import type { JsonObject } from '../dsl/json.ts';
import type { RunInput } from '../machine/run-input.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
import { testWorkflowMachine } from '../pool-testing/test-sandbox.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import { armedTimerIds, drivenRun } from './run-history.ts';

export function startedStateOf(document: JsonObject): RunState {
  return drivenRun(document)
    .events.slice(0, 1)
    .reduce((state, { event }) => evolveRun(state, event), newRun);
}

export function afterTheWaits(state: RunState, milliseconds: number): RunState {
  return armedTimerIds(state, 'wait')
    .map((timerId): RunInput => ({
      kind: 'timer_fired',
      runId: state.runId,
      at: state.lastInputAt + milliseconds,
      timerId,
    }))
    .reduce(
      (folded, input) =>
        Result.getOrThrow(testWorkflowMachine.decide(input, folded)).reduce(
          (next, event) => evolveRun(next, event),
          folded,
        ),
      state,
    );
}

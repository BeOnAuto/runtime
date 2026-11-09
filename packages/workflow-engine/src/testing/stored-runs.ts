import { Result } from 'effect';

import type { JsonObject } from '../dsl/json.ts';
import type { RunInput } from '../machine/run-input.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
import { testWorkflowMachine } from '../pool-testing/test-sandbox.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import type { TimerPurpose } from '../timers/timer-id.ts';
import { armedTimerIds, drivenRun } from './run-history.ts';

export function startedStateOf(document: JsonObject): RunState {
  return drivenRun(document)
    .events.slice(0, 1)
    .reduce((state, { event }) => evolveRun(state, event), newRun);
}

function afterTheTimers(state: RunState, purpose: TimerPurpose, milliseconds: number): RunState {
  return armedTimerIds(state, purpose)
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

export function afterTheWaits(state: RunState, milliseconds: number): RunState {
  return afterTheTimers(state, 'wait', milliseconds);
}

export function afterTheTimeouts(state: RunState, milliseconds: number): RunState {
  return afterTheTimers(state, 'timeout', milliseconds);
}

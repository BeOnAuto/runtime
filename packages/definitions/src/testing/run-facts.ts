import { recordingOf, type Context } from '@on.auto/operations';

import { runDecider } from '../runs/run-decider.ts';
import type { RecordedCall, RecordedCallFact, RecordedRunEvent, RunEvent } from '../runs/run-events.ts';
import type { RunStreamState } from '../runs/run-state.ts';

export const testRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const recordedRunEvent = recordingOf(runDecider.eventSchema);

export function recordedWith(context: Context): (event: RunEvent) => RecordedRunEvent {
  return (event) => recordedRunEvent(event, context);
}

export function runStateAfter(recorded: readonly RecordedRunEvent[]): RunStreamState {
  let state = runDecider.initialState;
  for (const event of recorded) {
    state = runDecider.evolve(state, event);
  }
  return state;
}

export function recordedOnTheRun(fact: RecordedCallFact, at = '2026-10-01T09:00:02.000Z'): RecordedCall {
  const context = {
    runId: testRunId,
    by: 'acme-admin',
    at,
    definitionType: 'tool-user',
    definitionName: 'caller',
    definitionVersion: 1,
  };
  return { ...fact, context };
}

import { Result } from 'effect';

import { staleReasonOf } from '../machine/admission.ts';
import { inputTimeOf, receiptOf } from '../machine/input-receipt.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
import { isoInstantOf } from '../machine/utc-time.ts';
import { withHistoryBytes, type RunLogEvent } from '../run-log/run-event.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import { stateFormat } from '../run-log/state-format.ts';

function counted(input: RunInput, state: RunState): readonly RunLogEvent[] {
  if (staleReasonOf(state, input, new Map()) !== undefined) {
    return [];
  }
  const at = inputTimeOf(state, input);
  return [
    withHistoryBytes(
      {
        type: 'input_applied',
        format: stateFormat,
        receipt: receiptOf(input, at),
        steps: [],
        patch: [
          { op: 'replace', path: '/runId', value: input.runId },
          { op: 'replace', path: '/status', value: 'running' },
          { op: 'replace', path: '/inputs', value: state.inputs + 1 },
          { op: 'replace', path: '/lastInputAt', value: at },
          { op: 'replace', path: '/cancelRequested', value: input.kind === 'cancel_requested' },
        ],
        outputs: [],
      },
      state.historyBytes,
    ),
  ];
}

export const countingDecider: RunDecider = {
  initialState: newRun,
  evolve: evolveRun,
  context: (input, state) => ({
    at: isoInstantOf(inputTimeOf(state, input)),
    by: 'counter',
    runId: input.runId,
    definitionType: 'workflow',
    definitionName: 'counted',
    definitionVersion: 1,
  }),
  decide: (input, state) => Result.succeed(counted(input, state)),
  decision: (input, state) => ({ events: counted(input, state), payloads: [] }),
};

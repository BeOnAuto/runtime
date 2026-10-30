import type { RunOutput } from '../dispatch/run-output.ts';
import { callKeyText } from '../executor/call-key.ts';
import type { InputReceipt } from '../machine/input-receipt.ts';
import type { RunState } from '../machine/run-state.ts';
import { withHistoryBytes, type RunLogEvent } from '../run-log/run-event.ts';
import { stateFormat } from '../run-log/state-format.ts';
import type { SessionResult } from '../runner/session.ts';
import { patchBetween } from './state-diff.ts';

function keyOf(output: RunOutput): string | undefined {
  if (output.kind === 'arm_timer' || output.kind === 'cancel_timer') {
    return `timer ${output.timerId}`;
  }
  if (output.kind === 'arm_listener' || output.kind === 'cancel_listener') {
    return `listener ${callKeyText(output.key)}`;
  }
  return output.kind === 'start_call' || output.kind === 'cancel_call' ? `call ${callKeyText(output.key)}` : undefined;
}

function isOpening(output: RunOutput): boolean {
  return output.kind === 'arm_timer' || output.kind === 'start_call' || output.kind === 'arm_listener';
}

export function withoutUndone(outputs: readonly RunOutput[]): readonly RunOutput[] {
  const opened = new Set(outputs.filter((output) => isOpening(output)).map((output) => keyOf(output)));
  const undone = new Set(
    outputs.filter((output) => !isOpening(output) && opened.has(keyOf(output))).map((output) => keyOf(output)),
  );
  return outputs.filter((output) => !undone.has(keyOf(output)));
}

export function eventOf(state: RunState, result: SessionResult, receipt: InputReceipt): RunLogEvent {
  return withHistoryBytes(
    {
      type: 'input_applied',
      format: stateFormat,
      receipt,
      steps: result.steps,
      resumed: result.resumed,
      patch: patchBetween(state, result.state),
      outputs: withoutUndone(result.outputs),
    },
    state.historyBytes,
  );
}

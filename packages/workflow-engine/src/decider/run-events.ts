import type { PerformedOutput } from '../dispatch/run-output.ts';
import { callKeyText } from '../executor/call-key.ts';
import type { RunAtHand } from '../machine/held-contents.ts';
import type { InputReceipt } from '../machine/input-receipt.ts';
import type { RunState } from '../machine/run-state.ts';
import { withHistoryBytes, type RunLogEvent } from '../run-log/run-event.ts';
import { formatWritten, stateFormat } from '../run-log/state-format.ts';
import type { SessionResult } from '../runner/session.ts';
import { keepingOf, type Keeping } from './kept-payloads.ts';
import { patchBetween } from './state-diff.ts';

export interface DecidedEvent {
  readonly event: RunLogEvent;
  readonly payloads: Keeping['payloads'];
}

function keyOf(output: PerformedOutput): string | undefined {
  if (output.kind === 'arm_timer' || output.kind === 'cancel_timer') {
    return `timer ${output.timerId}`;
  }
  if (output.kind === 'arm_listener' || output.kind === 'cancel_listener') {
    return `listener ${callKeyText(output.key)}`;
  }
  return output.kind === 'start_call' || output.kind === 'cancel_call' ? `call ${callKeyText(output.key)}` : undefined;
}

function isOpening(output: PerformedOutput): boolean {
  return output.kind === 'arm_timer' || output.kind === 'start_call' || output.kind === 'arm_listener';
}

export function withoutUndone(outputs: readonly PerformedOutput[]): readonly PerformedOutput[] {
  const opened = new Set(outputs.filter((output) => isOpening(output)).map((output) => keyOf(output)));
  const undone = new Set(
    outputs.filter((output) => !isOpening(output) && opened.has(keyOf(output))).map((output) => keyOf(output)),
  );
  return outputs.filter((output) => !undone.has(keyOf(output)));
}

export function eventOf(
  state: RunState,
  result: SessionResult,
  receipt: InputReceipt,
  atHand: RunAtHand,
): DecidedEvent {
  const format = formatWritten(atHand.format, atHand.payloadOffloading);
  const decided = { type: 'input_applied', receipt, steps: result.steps, resumed: result.resumed } as const;
  const outputs = withoutUndone(result.outputs);
  if (format === stateFormat) {
    const event = withHistoryBytes(
      { ...decided, format: stateFormat, patch: patchBetween(state, result.state), outputs },
      state.historyBytes,
    );
    return { event, payloads: [] };
  }
  const keeping = keepingOf(state, result.state, {
    outputs,
    payloadOffloading: atHand.payloadOffloading,
    payloadSizeThreshold: atHand.payloadSizeThreshold,
  });
  const event = {
    ...decided,
    format,
    patch: patchBetween(state, keeping.state),
    outputs: keeping.outputs,
    kept: keeping.kept,
  };
  return { event: withHistoryBytes(event, state.historyBytes), payloads: keeping.payloads };
}

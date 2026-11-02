import type { RunEvent } from '../runs/run-events.ts';
import type { AskedCancel, RecordedRunState } from '../runs/run-state.ts';

type Cancel = Pick<AskedCancel, 'kind' | 'reason'>;

const effectUnknown =
  'its attempt ended while it called a tool that may change something, so whether that call did is not known';

const nothingChanged = "every tool it called only reads, by its server's own account, so nothing was changed";

function effectOf({ openCalls, mayHaveChanged, calledOnlyReadOnly }: RecordedRunState): string | undefined {
  if (openCalls.size > 0 && !calledOnlyReadOnly) {
    return effectUnknown;
  }
  return mayHaveChanged && calledOnlyReadOnly ? nothingChanged : undefined;
}

function interruptedCall(number: number): RunEvent {
  return { type: 'tool_call_failed', data: { number, because: 'interrupted', duration_ms: 0, jsonrpc_id: null } };
}

export function endingOfADeadAttempt(run: RecordedRunState, { kind, reason }: Cancel): readonly RunEvent[] {
  const effect = effectOf(run);
  const detail = effect === undefined ? reason : `${reason}; ${effect}`;
  return [
    ...[...run.openCalls].map((number) => interruptedCall(number)),
    { type: 'run_rejected', data: { rejection: { reason: 'cancelled', kind, detail } } },
  ];
}

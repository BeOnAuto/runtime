import { capitalized } from '@on.auto/phrasing';

import type { RunEvent } from '../runs/run-events.ts';
import { calledAToolThatMayChangeSomething, type AskedCancel, type RecordedRunState } from '../runs/run-state.ts';

type Cancel = Pick<AskedCancel, 'kind' | 'reason'>;

const effectUnknown =
  'its attempt ended while it called a tool that may change something, so whether that call did is not known';

const nothingChanged = "every tool it called only reads, by its server's own account, so nothing was changed";

function anActingCallIsOpen({ openActingCalls }: RecordedRunState): boolean {
  return openActingCalls.size > 0;
}

function calledOnlyReadingTools({ mayHaveChanged, calledOnlyReadOnly }: RecordedRunState): boolean {
  return mayHaveChanged && calledOnlyReadOnly;
}

function effectOf(run: RecordedRunState): string | undefined {
  if (anActingCallIsOpen(run)) {
    return effectUnknown;
  }
  return calledOnlyReadingTools(run) ? nothingChanged : undefined;
}

function interruptedCalls({ openCalls }: RecordedRunState): readonly RunEvent[] {
  return [...openCalls].map((number) => ({
    type: 'tool_call_failed',
    data: { number, because: 'interrupted', duration_ms: 0, jsonrpc_id: null },
  }));
}

export function endingOfADeadAttempt(run: RecordedRunState, { kind, reason }: Cancel): readonly RunEvent[] {
  const effect = effectOf(run);
  const detail = effect === undefined ? reason : `${reason}; ${effect}`;
  return [
    ...interruptedCalls(run),
    { type: 'run_rejected', data: { rejection: { reason: 'cancelled', kind, detail } } },
  ];
}

function endOfAnAttemptThatDied(run: RecordedRunState): RunEvent {
  if (calledAToolThatMayChangeSomething(run)) {
    return {
      type: 'run_rejected',
      data: {
        rejection: {
          reason: 'conflict',
          kind: 'effect_unknown',
          because: 'call_outcome_unknown',
          detail: capitalized(effectUnknown),
        },
      },
    };
  }
  if (calledOnlyReadingTools(run)) {
    return {
      type: 'run_rejected',
      data: { rejection: { reason: 'unavailable', kind: 'tools_unfinished', detail: capitalized(nothingChanged) } },
    };
  }
  return { type: 'run_failed', data: {} };
}

export function endingOfAnAttemptThatDied(run: RecordedRunState): readonly RunEvent[] {
  return [...interruptedCalls(run), endOfAnAttemptThatDied(run)];
}

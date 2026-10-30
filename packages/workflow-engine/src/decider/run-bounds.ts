import { raised } from '../dsl/raised-error.ts';
import type { DslError } from '../machine/dsl-error.ts';
import { mostEventBytes, mostHeldBytes, mostHistoryBytes, mostInputs } from '../machine/limits.ts';
import type { RunState } from '../machine/run-state.ts';
import { eventBytesOf, type RunLogEvent } from '../run-log/run-event.ts';
import type { SessionResult } from '../runner/session.ts';

function boundError(title: string): DslError {
  return raised('runtime', 500, title, '/').error;
}

export function brokenBound(state: RunState, event: RunLogEvent, result: SessionResult): DslError | undefined {
  const bytes = eventBytesOf(event);
  if (bytes > mostEventBytes) {
    return boundError(`An input changed the run by ${bytes} bytes, more than the ${mostEventBytes} one event holds`);
  }
  if (state.historyBytes + bytes > mostHistoryBytes) {
    return boundError(
      `The run's history would take ${state.historyBytes + bytes} bytes, more than the ${mostHistoryBytes} a run keeps`,
    );
  }
  const held = result.state.heldBytes;
  return held > mostHeldBytes
    ? boundError(
        `The workflow would hold about ${held} bytes of data at once, more than the ${mostHeldBytes} a workflow may hold`,
      )
    : undefined;
}

export function inputsBound(state: RunState): DslError | undefined {
  return state.inputs >= mostInputs ? boundError(`The run took ${mostInputs} inputs, the most a run takes`) : undefined;
}

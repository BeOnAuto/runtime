import { raised } from '../dsl/raised-error.ts';
import type { DslError } from '../machine/dsl-error.ts';
import { lostContentOf, type HeldContents } from '../machine/held-contents.ts';
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
    return boundError(
      `The run would record ${bytes} bytes at once, more than the ${mostEventBytes} it may record at once; keep less across a wait, and start calls with large inputs one after another`,
    );
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

export function fitsInOneEvent(event: RunLogEvent): boolean {
  return eventBytesOf(event) <= mostEventBytes;
}

export function lostContentBound(state: RunState, contents: HeldContents): DslError | undefined {
  const lost = lostContentOf(state, contents);
  if (lost === undefined) {
    return undefined;
  }
  const how = lost.kind === 'missing' ? 'is missing from the content it was kept in' : 'was erased';
  return boundError(`A value the workflow holds, kept under ${lost.sha256}, ${how}`);
}

export function inputsBound(state: RunState): DslError | undefined {
  return state.inputs >= mostInputs ? boundError(`The run took ${mostInputs} inputs, the most a run takes`) : undefined;
}

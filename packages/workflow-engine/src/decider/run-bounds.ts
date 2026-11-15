import { raised } from '../dsl/raised-error.ts';
import type { DslError } from '../machine/dsl-error.ts';
import { lostContentOf, type HeldContents, type LostContent, type RunAtHand } from '../machine/held-contents.ts';
import { mostEventBytes, mostHeldBytes, mostHistoryBytes, mostInputs } from '../machine/limits.ts';
import type { RunState } from '../machine/run-state.ts';
import { eventBytesOf, writtenBytesOf, type RunLogEvent } from '../run-log/run-event.ts';
import type { SessionResult } from '../runner/session.ts';

function boundError(title: string): DslError {
  return raised('runtime', 500, title, '/').error;
}

function whatToDoAt({ payloadOffloading }: RunAtHand): string {
  return payloadOffloading
    ? 'keep less across a wait, and start calls with large inputs one after another'
    : 'keep less across a wait, start calls with large inputs one after another, or turn on payload offloading';
}

export function brokenBound(
  state: RunState,
  event: RunLogEvent,
  result: SessionResult,
  atHand: RunAtHand,
): DslError | undefined {
  const written = writtenBytesOf(event);
  if (written > mostEventBytes) {
    return boundError(
      `The run would record ${written} bytes at once, more than the ${mostEventBytes} it may record at once; ${whatToDoAt(atHand)}`,
    );
  }
  const history = state.historyBytes + eventBytesOf(event);
  if (history > mostHistoryBytes) {
    return boundError(`The run's history would take ${history} bytes, more than the ${mostHistoryBytes} a run keeps`);
  }
  const held = result.state.heldBytes;
  return held > mostHeldBytes
    ? boundError(
        `The workflow would hold about ${held} bytes of data at once, more than the ${mostHeldBytes} a workflow may hold`,
      )
    : undefined;
}

export function fitsInOneEvent(event: RunLogEvent): boolean {
  return writtenBytesOf(event) <= mostEventBytes;
}

export function lostKeptBound(what: string, { sha256, kind }: LostContent): DslError {
  const how = kind === 'missing' ? 'is missing from the content it was kept in' : 'was erased';
  return boundError(`${what}, kept under ${sha256}, ${how}`);
}

export function lostContentBound(state: RunState, contents: HeldContents): DslError | undefined {
  const lost = lostContentOf(state, contents);
  return lost === undefined ? undefined : lostKeptBound('A value the workflow holds', lost);
}

export function inputsBound(state: RunState): DslError | undefined {
  return state.inputs >= mostInputs ? boundError(`The run took ${mostInputs} inputs, the most a run takes`) : undefined;
}

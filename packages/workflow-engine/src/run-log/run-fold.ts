import { Data, Schema } from 'effect';

import { newRun, RunStateSchema, type RunState } from '../machine/run-state.ts';
import { stateFormats } from './known-formats.ts';
import { eventBytesOf, type PositionedEvent, type RunLogEvent } from './run-event.ts';
import type { StoredRun } from './run-store.ts';
import type { SinceSnapshot } from './snapshot.ts';
import type { OlderFormat, StateFormats } from './state-format.ts';
import { applyStatePatch } from './state-patch.ts';

export interface LoadedRun {
  readonly state: RunState;
  readonly version: number;
  readonly sinceSnapshot: SinceSnapshot;
}

export class UnreadableRun extends Data.TaggedError('unreadable_run')<{ readonly detail: string }> {}

interface Folding {
  readonly format: number;
  readonly state: unknown;
}

interface FoldStart extends Folding {
  readonly version: number;
  readonly historyBytes: number;
  readonly snapshotBytes: number;
}

const decodeState = Schema.decodeUnknownSync(RunStateSchema, { onExcessProperty: 'error' });

function olderFormatOf(formats: StateFormats, format: number): OlderFormat {
  const older = formats.older.find((candidate: OlderFormat) => candidate.format === format);
  if (older === undefined) {
    throw new UnreadableRun({ detail: `This code reads no state of format ${format}` });
  }
  return older;
}

function initialStateOf(formats: StateFormats, format: number): unknown {
  return format === formats.current ? newRun : olderFormatOf(formats, format).initial;
}

function upcastTo(formats: StateFormats, folding: Folding, format: number): Folding {
  if (format > formats.current) {
    throw new UnreadableRun({
      detail: `State format ${format} is newer than ${formats.current}, the newest this code reads`,
    });
  }
  if (format < folding.format) {
    throw new UnreadableRun({
      detail: `State format ${format} follows format ${folding.format}; formats never go back`,
    });
  }
  if (format === folding.format) {
    return folding;
  }
  const older = olderFormatOf(formats, folding.format);
  return upcastTo(formats, { format: folding.format + 1, state: older.upcast(older.read(folding.state)) }, format);
}

function startOf({ snapshot, tail }: StoredRun, formats: StateFormats): FoldStart {
  if (snapshot === null) {
    const format = Math.min(tail[0]?.event.format ?? formats.current, formats.current);
    return { format, state: initialStateOf(formats, format), version: 0, historyBytes: 0, snapshotBytes: 0 };
  }
  return { ...snapshot.snapshot, snapshotBytes: snapshot.bytes };
}

function requireContiguous(tail: readonly PositionedEvent[], after: number): void {
  for (const [index, { version }] of tail.entries()) {
    if (version !== after + index + 1) {
      throw new UnreadableRun({ detail: `Event ${after + index + 1} is missing; the next event read is ${version}` });
    }
  }
}

function requireHistoryBytes(state: RunState, expected: number): void {
  if (state.historyBytes !== expected) {
    throw new UnreadableRun({
      detail: `The state counts ${state.historyBytes} bytes of history, and its events take ${expected}`,
    });
  }
}

export function stateInCurrentFormat(format: number, state: unknown, formats: StateFormats = stateFormats): RunState {
  return decodeState(upcastTo(formats, { format, state }, formats.current).state);
}

export function evolveRun(state: RunState, event: RunLogEvent): RunState {
  const { state: patched } = upcastTo(stateFormats, { format: stateFormats.current, state }, event.format);
  return decodeState(applyStatePatch(patched, event.patch));
}

export function loadedRunOf(stored: StoredRun, formats: StateFormats = stateFormats): LoadedRun {
  const start = startOf(stored, formats);
  requireContiguous(stored.tail, start.version);
  const folded = stored.tail.reduce((folding: Folding, { event }: PositionedEvent): Folding => {
    const upcast = upcastTo(formats, folding, event.format);
    return { format: upcast.format, state: applyStatePatch(upcast.state, event.patch) };
  }, start);
  const state = stateInCurrentFormat(folded.format, folded.state, formats);
  const tailBytes = stored.tail.reduce((sum, { event }: PositionedEvent) => sum + eventBytesOf(event), 0);
  requireHistoryBytes(state, start.historyBytes + tailBytes);
  return {
    state,
    version: start.version + stored.tail.length,
    sinceSnapshot: { bytes: tailBytes, snapshotBytes: start.snapshotBytes },
  };
}

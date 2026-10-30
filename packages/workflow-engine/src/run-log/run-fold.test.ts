import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  eventBytesOf,
  evolveRun,
  loadedRunOf,
  newRun,
  snapshotOf,
  stateFormat,
  stateInCurrentFormat,
  UnreadableRun,
  withHistoryBytes,
  type OlderFormat,
  type PositionedEvent,
  type RunLogEvent,
  type StateFormats,
  type StatePatch,
} from '../index.ts';
import { at, runId } from '../testing/runs.ts';
import { exampleStream } from '../testing/streams.ts';

function bytesOf(events: readonly PositionedEvent[]): number {
  return events.reduce((sum, { event }: PositionedEvent) => sum + eventBytesOf(event), 0);
}

function eventIn(format: number, patch: StatePatch, before: number): RunLogEvent {
  return withHistoryBytes(
    {
      type: 'input_applied',
      format,
      receipt: { kind: 'cancel_requested', key: runId, at },
      steps: [],
      patch,
      outputs: [],
    },
    before,
  );
}

function streamIn(changes: readonly (readonly [number, StatePatch])[]): readonly PositionedEvent[] {
  return changes.reduce(
    (events: readonly PositionedEvent[], [format, patch]: readonly [number, StatePatch], index) => [
      ...events,
      { version: index + 1, event: eventIn(format, patch, bytesOf(events)) },
    ],
    [],
  );
}

const { inputs: _inputs, ...withoutInputs } = newRun;

function isCounting(state: unknown): state is { readonly applied: number } {
  return typeof state === 'object' && state !== null && typeof Reflect.get(state, 'applied') === 'number';
}

const countingApplied: OlderFormat = {
  format: 1,
  initial: { ...withoutInputs, applied: 0 },
  read: (state) => {
    if (!isCounting(state)) {
      throw new TypeError('A state of format 1 counts its inputs as applied');
    }
    return state;
  },
  upcast: (state) => {
    const { applied, ...rest } = isCounting(state) ? state : { applied: 0 };
    return { ...rest, inputs: applied };
  },
};

const twoFormats: StateFormats = { current: 2, older: [countingApplied] };

const started: StatePatch = [
  { op: 'replace', path: '/runId', value: runId },
  { op: 'replace', path: '/status', value: 'running' },
];

function patched(patch: StatePatch): RunLogEvent {
  return eventIn(stateFormat, patch, 0);
}

describe('a run loaded from its stream', () => {
  it('is the fold of its events from a new run, with its version and the bytes of its history', () => {
    const loaded = loadedRunOf({ snapshot: null, tail: exampleStream });

    expect(loaded).toMatchObject({
      version: 3,
      sinceSnapshot: { bytes: bytesOf(exampleStream), snapshotBytes: 0 },
      state: { runId, status: 'running', inputs: 3, historyBytes: bytesOf(exampleStream), timers: { armed: {} } },
    });
    expect(loadedRunOf({ snapshot: null, tail: [] }).state).toEqual(newRun);
  });
});

describe('a run loaded from a snapshot', () => {
  it('is the same from its latest snapshot and the events after it as from its whole stream', () => {
    const atTwo = loadedRunOf({ snapshot: null, tail: exampleStream.slice(0, 2) });
    const tail = exampleStream.slice(2);

    const fromSnapshot = loadedRunOf({ snapshot: { snapshot: snapshotOf(atTwo.state, 2), bytes: 5000 }, tail });

    expect(fromSnapshot).toEqual({
      ...loadedRunOf({ snapshot: null, tail: exampleStream }),
      sinceSnapshot: { bytes: bytesOf(tail), snapshotBytes: 5000 },
    });
    expect(tail.reduce((state, { event }: PositionedEvent) => evolveRun(state, event), atTwo.state)).toEqual(
      fromSnapshot.state,
    );
  });
});

describe('a run that cannot be read', () => {
  it('dies on a gap in its events, or on events whose sizes are not the bytes of history the state counts', () => {
    const afterAGap = streamIn([
      [stateFormat, started],
      [stateFormat, []],
    ]).slice(1);
    const miscounted = streamIn([[stateFormat, started]]).map(({ version, event }) => ({
      version,
      event: {
        ...event,
        patch: [...event.patch.slice(0, -1), { op: 'replace' as const, path: '/historyBytes', value: 1 }],
      },
    }));

    expect(() => loadedRunOf({ snapshot: null, tail: afterAGap })).toThrow(
      new UnreadableRun({ detail: 'Event 1 is missing; the next event read is 2' }),
    );
    expect(() => loadedRunOf({ snapshot: null, tail: miscounted })).toThrow(UnreadableRun);
  });

  it('dies on a patch that leaves a state this format does not describe, an unknown member included', () => {
    expect(() => evolveRun(newRun, patched([{ op: 'replace', path: '/status', value: 'paused' }]))).toThrow(
      /Expected "new" \| "running" \| "ended"/u,
    );
    expect(() => evolveRun(newRun, patched([{ op: 'add', path: '/machine/extra', value: 1 }]))).toThrow(/extra/u);
  });
});

describe('the state formats of a stream', () => {
  it('fold each event under its own format and upcast the state where the format changes', () => {
    const stream = streamIn([
      [1, [...started, { op: 'replace', path: '/applied', value: 1 }]],
      [1, [{ op: 'replace', path: '/applied', value: 2 }]],
      [2, [{ op: 'replace', path: '/inputs', value: 3 }]],
    ]);

    expect(loadedRunOf({ snapshot: null, tail: stream }, twoFormats).state).toMatchObject({
      inputs: 3,
      status: 'running',
    });
    expect(loadedRunOf({ snapshot: null, tail: stream.slice(0, 2) }, twoFormats).state).toMatchObject({ inputs: 2 });
  });

  it('upcast a snapshot of an older format before the events after it', () => {
    const olderState = Schema.decodeUnknownSync(Schema.Json)({ ...withoutInputs, applied: 4 });
    const snapshot = { format: 1, runId, version: 4, historyBytes: 0, state: olderState };
    const tail = streamIn([[2, [{ op: 'replace', path: '/inputs', value: 5 }]]]).map(({ event }) => ({
      version: 5,
      event,
    }));

    expect(loadedRunOf({ snapshot: { snapshot, bytes: 100 }, tail }, twoFormats).state).toMatchObject({ inputs: 5 });
    expect(stateInCurrentFormat(1, olderState, twoFormats)).toMatchObject({ inputs: 4 });
  });
});

describe('a state format this code does not read', () => {
  it('is refused: formats never go back within a stream, and a format must be one this code knows', () => {
    const goingBack = streamIn([
      [2, started],
      [1, []],
    ]);
    const newer = streamIn([[3, started]]);
    const unknown = streamIn([[1, started]]);

    expect(() => loadedRunOf({ snapshot: null, tail: goingBack }, twoFormats)).toThrow(
      new UnreadableRun({ detail: 'State format 1 follows format 2; formats never go back' }),
    );
    expect(() => loadedRunOf({ snapshot: null, tail: newer }, twoFormats)).toThrow(
      new UnreadableRun({ detail: 'State format 3 is newer than 2, the newest this code reads' }),
    );
    expect(() => loadedRunOf({ snapshot: null, tail: unknown }, { current: 2, older: [] })).toThrow(
      new UnreadableRun({ detail: 'This code reads no state of format 1' }),
    );
    expect(() => evolveRun(newRun, eventIn(stateFormat + 1, [], 0))).toThrow(UnreadableRun);
  });

  it('read a state of an older format strictly before upcasting it', () => {
    expect(() => stateInCurrentFormat(1, { ...withoutInputs, inputs: 4 }, twoFormats)).toThrow(
      'A state of format 1 counts its inputs as applied',
    );
  });
});

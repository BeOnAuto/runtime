import { describe, expect, it } from 'vitest';

import { nothingAtHand } from '../machine/held-contents.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import { testMachine } from '../pool-testing/test-sandbox.ts';
import { at, openCall, runId, runningState, started } from '../testing/runs.ts';
import { deciding } from './deciding.ts';
import { decided } from './decision.ts';
import { endingEvent } from './run-endings.ts';

type HeldValues = RunState['machine']['values'];

type Held = HeldValues[string];

function readingThrows(values: HeldValues): HeldValues {
  return Object.fromEntries(
    Object.entries(values).map(([id, { bytes }]: readonly [string, Held]) => [
      id,
      Object.defineProperty({ bytes, value: null }, 'value', {
        enumerable: true,
        get: () => {
          throw new Error(`The value ${id} was read`);
        },
      }),
    ]),
  );
}

function digestOf(id: string): string {
  return id.repeat(64).slice(0, 64);
}

const watched: RunState = {
  ...runningState,
  machine: { ...runningState.machine, values: readingThrows(runningState.machine.values) },
};

const keptEverywhere: RunState = {
  ...runningState,
  machine: {
    ...runningState.machine,
    values: Object.fromEntries(
      Object.entries(runningState.machine.values).map(([id, { bytes }]: readonly [string, Held]) => [
        id,
        { sha256: digestOf(id), bytes },
      ]),
    ),
  },
};

const allMissing = new Map(
  Object.keys(runningState.machine.values).map((id) => [digestOf(id), { kind: 'missing' }] as const),
);

const inputs: readonly RunInput[] = [
  { kind: 'timer_fired', runId, at: at + 1, timerId: '1' },
  { kind: 'call_answered', runId, at: at + 1, key: openCall, result: { status: 'succeeded', output: 1 } },
  { kind: 'cancel_requested', runId, at: at + 1, cancel: { by: 'a', kind: 'requested', reason: 'r' } },
  { kind: 'event_received', runId, at: at + 1, event: { id: 'e', type: 't' } },
];

const gone = { type: 'runtime', status: 500, title: 'gone', instance: '/' };

const nothing = nothingAtHand();

function settledAs({ events }: ReturnType<typeof decided>): readonly string[] {
  return events.flatMap(({ outputs }) =>
    outputs.flatMap((output) => (output.kind === 'settle' ? [output.settlement.status] : [])),
  );
}

describe('the ending a decision gives a run', () => {
  it('reads no value the run holds, whatever the input, so it can end a run whose values cannot be read', () => {
    const endings = inputs.map((input) =>
      deciding(testMachine, nothing, (options) => endingEvent(watched, options, input, gone)),
    );

    expect(endings.map(({ event }) => event.outputs.at(-1)?.kind)).toEqual(inputs.map(() => 'settle'));
    expect(() =>
      deciding(testMachine, nothing, (options) => decided(options, { ...started, at: at + 1 }, watched)),
    ).toThrow('The value 1 was read');
  });

  it('ends a run whose every value is kept and lost, reading none, in an event of the format the run reached', () => {
    const endings = inputs.map((input) =>
      deciding(testMachine, { contents: allMissing, format: 12, payloadOffloading: false }, (options) =>
        decided(options, input, keptEverywhere),
      ),
    );

    expect(endings.map(({ events }) => events.map(({ format }) => format))).toEqual(inputs.map(() => [12]));
    expect(endings.map(({ payloads }) => payloads)).toEqual(inputs.map(() => []));
    expect(endings.map((ending) => settledAs(ending))).toEqual(inputs.map(() => ['rejected']));
  });
});

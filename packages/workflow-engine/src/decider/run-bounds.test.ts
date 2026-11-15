import { describe, expect, it } from 'vitest';

import { addsAKeptValue } from '../kept-testing/kept-events.ts';
import { mostEventBytes, mostHeldBytes, mostHistoryBytes, mostInputs } from '../machine/limits.ts';
import type { RunOutcome } from '../machine/run-state.ts';
import { eventBytesOf, type RunLogEvent } from '../run-log/run-event.ts';
import { drivenRun, type DrivenRun } from '../testing/run-history.ts';
import { afterTheWaits, startedStateOf } from '../testing/stored-runs.ts';
import { workflow } from '../testing/workflows.ts';

const megabyte = 1_048_576;

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

const keepLess = 'keep less across a wait, and start calls with large inputs one after another';

const keepLessOrOffload =
  'keep less across a wait, start calls with large inputs one after another, or turn on payload offloading';

function tooMuchAtOnce(bytes: number, whatToDo: string): string {
  return `The run would record ${bytes} bytes at once, more than the ${mostEventBytes} it may record at once; ${whatToDo}`;
}

const heldTooMuch = new RegExp(
  `^The workflow would hold about \\d+ bytes of data at once, more than the ${mostHeldBytes} a workflow may hold$`,
  'u',
);

function titleOf(outcome: RunOutcome | null): string {
  return outcome?.kind === 'raised' ? (outcome.error.title ?? '') : JSON.stringify(outcome);
}

function writtenBytesOf(event: RunLogEvent): number {
  return new TextEncoder().encode(JSON.stringify(event)).byteLength;
}

function eventAt(run: DrivenRun, index: number): RunLogEvent {
  const positioned = run.events[index];
  if (positioned === undefined) {
    throw new RangeError(`The run recorded no event ${index + 1}`);
  }
  return positioned.event;
}

describe('a run ends, raised, in one small event, when an input would make an event larger than one event holds, in words that say what to do', () => {
  it('at its start, and keeps no part of it', () => {
    const run = drivenRun(workflow('do:\n  - greet: { set: { done: true } }'), {
      input: { text: 'x'.repeat(mostEventBytes) },
    });

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(
        `^The run would record \\d+ bytes at once, more than the ${mostEventBytes} it may record at once; ${keepLessOrOffload}$`,
        'u',
      ),
    );
    expect(run.ended.workflow?.document).toEqual({});
    expect(run.events.map(({ event }) => eventBytesOf(event) < 4096)).toEqual([true]);
  });

  it('with an answer', () => {
    const run = drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }\n  - pause: { wait: PT1H }'), {
      respond: () => ({ result: { status: 'succeeded', output: 'x'.repeat(2 * megabyte) } }),
    });

    expect(titleOf(run.outcome)).toContain(`more than the ${mostEventBytes} it may record at once`);
    expect(run.events.every(({ event }) => eventBytesOf(event) <= mostEventBytes)).toBe(true);
  });
});

interface Keeping {
  readonly payloadOffloading?: boolean;
  readonly payloadSizeThreshold?: number;
}

function holdingAcross(pause: string, length: number, keeping: Keeping = {}): DrivenRun {
  return drivenRun(
    workflow(`
do:
  - make: { set: { s: '\${ "x".repeat(${length}) }' } }
  - pause: ${pause}
  - measure: { set: '\${ ({ length: $data.s.length }) }' }
`),
    keeping,
  );
}

function longestHeldAcross(pause: string, keeping: Keeping = {}): number {
  const near = mostEventBytes - 4096;
  const [first = 0] = holdingAcross(pause, near, keeping).events.map(({ event }) => eventBytesOf(event));
  return near + mostEventBytes - first;
}

const pauses = [
  ['a wait', '{ wait: PT1S }'],
  ['a yield', "{ for: { in: '${ Array.from({ length: 120 }, (_, index) => index) }' }, do: [] }"],
] as const;

describe('a value a run holds across a wait or a yield', () => {
  it.each(pauses)(
    'is held in the event of the input that made it where payload offloading is off, and ends the run when it is one byte larger, in words that say to turn payload offloading on: across %s',
    (_across, pause) => {
      const longest = longestHeldAcross(pause);

      expect(longest).toBeGreaterThan(mostEventBytes - 4096);
      expect(holdingAcross(pause, longest).outcome).toEqual({ kind: 'completed', output: { length: longest } });
      expect(titleOf(holdingAcross(pause, longest + 1).outcome)).toBe(
        tooMuchAtOnce(mostEventBytes + 1, keepLessOrOffload),
      );
    },
  );

  it.each(pauses)(
    'is held in its event where its size is under the threshold of payload offloading, and bounded there by one event, in words that leave offloading out, as it is on: across %s',
    (_across, pause) => {
      const inline = { payloadOffloading: true, payloadSizeThreshold: 2 * mostEventBytes };
      const longest = longestHeldAcross(pause, inline);
      const held = holdingAcross(pause, longest, inline);

      expect(held.events.some(({ event }) => addsAKeptValue(event))).toBe(false);
      expect(held.outcome).toEqual({ kind: 'completed', output: { length: longest } });
      expect(titleOf(holdingAcross(pause, longest + 1, inline).outcome)).toBe(
        tooMuchAtOnce(mostEventBytes + 1, keepLess),
      );
    },
  );

  it('is not bounded by one event when the input that made it lets go of it', () => {
    const run = holdingAcross('{ set: { s: done } }', 2 * mostEventBytes);

    expect(run.outcome).toEqual({ kind: 'completed', output: { length: 4 } });
  });
});

describe('a value payload offloading keeps across a wait or a yield', () => {
  it.each(pauses)(
    'is named in its event by its digest and size, so the data a run holds bounds it rather than one event, and its history counts its bytes: across %s',
    (_across, pause) => {
      const length = 2 * mostEventBytes;
      const kept = holdingAcross(pause, length, { payloadOffloading: true });
      const made = eventAt(kept, 0);

      expect(kept.outcome).toEqual({ kind: 'completed', output: { length } });
      expect([addsAKeptValue(made), writtenBytesOf(made) < 4096, eventBytesOf(made) > length]).toEqual([
        true,
        true,
        true,
      ]);
      expect(titleOf(holdingAcross(pause, mostHeldBytes, { payloadOffloading: true }).outcome)).toMatch(heldTooMuch);
    },
  );
});

function startingAtOnce(calls: number, pageBytes: number, payloadOffloading: boolean): DrivenRun {
  const branches = Array.from(
    { length: calls },
    (_, index) => `          - b${index}: { call: notify, with: { to: b${index}, page: '\${ $data.page }' } }`,
  );
  return drivenRun(
    workflow(`
do:
  - first: { wait: PT1S }
  - make: { set: { page: '\${ "x".repeat(${pageBytes}) }' } }
  - write:
      fork:
        branches:
${branches.join('\n')}
  - done: { set: { written: ${calls} } }
`),
    { payloadOffloading },
  );
}

describe('calls a step starts at once', () => {
  it('with inputs payload offloading keeps, are started in one change that names each input by its digest and size, whatever those inputs take together, and the run goes on', () => {
    const run = startingAtOnce(3, 250_000, true);
    const started = eventAt(run, 1);

    expect(run.outcome).toEqual({ kind: 'completed', output: { written: 3 } });
    expect([writtenBytesOf(started) < 8192, eventBytesOf(started) > mostEventBytes]).toEqual([true, true]);
  });

  it('with inputs held in the change where payload offloading is off, end the run when that change passes one event, before any call, in words that say to start them one after another or turn payload offloading on', () => {
    const run = startingAtOnce(3, 250_000, false);

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(
        `^The run would record \\d+ bytes at once, more than the ${mostEventBytes} it may record at once; ${keepLessOrOffload}$`,
        'u',
      ),
    );
    expect(run.driver.ports.faults.dispatched().some(({ output }) => output.kind === 'start_call')).toBe(false);
  });

  it('with inputs payload offloading keeps, end the run, before any call, when the data the run holds would pass the most a workflow may hold', () => {
    const run = startingAtOnce(17, 250_000, true);

    expect(titleOf(run.outcome)).toMatch(heldTooMuch);
    expect(run.driver.ports.faults.dispatched().some(({ output }) => output.kind === 'start_call')).toBe(false);
  });
});

describe('a run ends, raised, in one small event', () => {
  it('when the data it holds would pass the most a workflow may hold', () => {
    const document = workflow(`
do:
  - all:
      fork:
        branches:
          - a: { call: notify, with: { to: a } }
          - b: { call: notify, with: { to: b } }
          - c: { call: notify, with: { to: c } }
          - d: { call: notify, with: { to: d } }
          - e: { wait: PT1H }
`);
    const output = 'x'.repeat(1.2 * megabyte);
    const run = drivenRun(document, {
      respond: (call) => ({ after: call.key.reference.length, result: { status: 'succeeded', output } }),
    });

    expect(titleOf(run.outcome)).toMatch(heldTooMuch);
  });

  it('when the input would take its history past the most a run keeps', () => {
    const ended = afterTheWaits({ ...startedStateOf(pausing), historyBytes: mostHistoryBytes - 100 }, 3_600_000);

    expect(titleOf(ended.outcome)).toMatch(
      /^The run's history would take \d+ bytes, more than the 536870912 a run keeps$/u,
    );
    expect(ended.timers.armed).toEqual({});
  });

  it(`when it has taken ${mostInputs} inputs`, () => {
    const ended = afterTheWaits({ ...startedStateOf(pausing), inputs: mostInputs }, 3_600_000);

    expect(titleOf(ended.outcome)).toBe(`The run took ${mostInputs} inputs, the most a run takes`);
    expect(ended.inputs).toBe(mostInputs + 1);
  });
});

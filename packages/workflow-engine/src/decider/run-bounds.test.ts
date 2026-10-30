import { describe, expect, it } from 'vitest';

import { mostEventBytes, mostHeldBytes, mostHistoryBytes, mostInputs } from '../machine/limits.ts';
import type { RunOutcome } from '../machine/run-state.ts';
import { eventBytesOf } from '../run-log/run-event.ts';
import { drivenRun, type DrivenRun } from '../testing/run-history.ts';
import { afterTheWaits, startedStateOf } from '../testing/stored-runs.ts';
import { workflow } from '../testing/workflows.ts';

const megabyte = 1_048_576;

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

function titleOf(outcome: RunOutcome | null): string {
  return outcome?.kind === 'raised' ? (outcome.error.title ?? '') : JSON.stringify(outcome);
}

describe('a run ends, raised, in one small event, when an input would make an event larger than one event holds', () => {
  it('at its start, and keeps no part of it', () => {
    const run = drivenRun(workflow('do:\n  - greet: { set: { done: true } }'), {
      input: { text: 'x'.repeat(mostEventBytes) },
    });

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(`^An input changed the run by \\d+ bytes, more than the ${mostEventBytes} one event holds$`, 'u'),
    );
    expect(run.ended.workflow?.document).toEqual({});
    expect(run.events.map(({ event }) => eventBytesOf(event) < 4096)).toEqual([true]);
  });

  it('with an answer', () => {
    const run = drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }\n  - pause: { wait: PT1H }'), {
      respond: () => ({ result: { status: 'succeeded', output: 'x'.repeat(2 * megabyte) } }),
    });

    expect(titleOf(run.outcome)).toContain('one event holds');
    expect(run.events.every(({ event }) => eventBytesOf(event) <= mostEventBytes)).toBe(true);
  });
});

function holdingAcross(pause: string, length: number): DrivenRun {
  return drivenRun(
    workflow(`
do:
  - make: { set: { s: '\${ "x".repeat(${length}) }' } }
  - pause: ${pause}
  - measure: { set: '\${ ({ length: $data.s.length }) }' }
`),
  );
}

function longestHeldAcross(pause: string): number {
  const near = mostEventBytes - 4096;
  const [first = 0] = holdingAcross(pause, near).events.map(({ event }) => eventBytesOf(event));
  return near + mostEventBytes - first;
}

describe('a value a run holds across a wait or a yield', () => {
  it.each([
    ['a wait', '{ wait: PT1S }'],
    ['a yield', "{ for: { in: '${ Array.from({ length: 120 }, (_, index) => index) }' }, do: [] }"],
  ])(
    'is kept when the event of the input that made it holds it, and ends the run when it is one byte larger: across %s',
    (_across, pause) => {
      const longest = longestHeldAcross(pause);

      expect(longest).toBeGreaterThan(mostEventBytes - 4096);
      expect(holdingAcross(pause, longest).outcome).toEqual({ kind: 'completed', output: { length: longest } });
      expect(titleOf(holdingAcross(pause, longest + 1).outcome)).toBe(
        `An input changed the run by ${mostEventBytes + 1} bytes, more than the ${mostEventBytes} one event holds`,
      );
    },
  );

  it('is not bounded by one event when the input that made it lets go of it', () => {
    const run = holdingAcross('{ set: { s: done } }', 2 * mostEventBytes);

    expect(run.outcome).toEqual({ kind: 'completed', output: { length: 4 } });
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

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(
        `^The workflow would hold about \\d+ bytes of data at once, more than the ${mostHeldBytes} a workflow may hold$`,
        'u',
      ),
    );
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

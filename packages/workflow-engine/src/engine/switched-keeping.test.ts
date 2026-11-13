import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { pauseEnded } from '../kept-testing/kept-drivers.ts';
import { keptAlong, keptValuesIn } from '../kept-testing/kept-events.ts';
import { isKept } from '../machine/held-contents.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { loadedRunOf } from '../run-log/run-fold.ts';
import { memoryDriver, type MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId, statesAlong } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const twice = workflow(`
do:
  - make: { set: '\${ "x".repeat(20000) }' }
  - pause: { wait: PT1M }
  - again: { set: '\${ ({ more: "y".repeat(20000), before: $data }) }' }
  - rest: { wait: PT1M }
`);

function startedThenSwitched(payloadOffloading: boolean): MemoryDriver {
  const driver = memoryDriver({ sandbox: testSandbox, payloadOffloading });
  driver.start({ runId: drivenRunId, document: twice });
  driver.ports.payloads.switchTo(!payloadOffloading);
  return driver;
}

function nextPauseEnded(driver: MemoryDriver): void {
  Effect.runSync(driver.engine.submit(pauseEnded(driver.state(drivenRunId))));
}

function largeArmsOf(driver: MemoryDriver): readonly (readonly (readonly [number, boolean])[])[] {
  return statesAlong(driver.ports.runStore.events(drivenRunId)).map((state) =>
    Object.values(state.machine.values)
      .filter(({ bytes }) => bytes > 4096)
      .map((held) => [held.bytes, isKept(held)] as const),
  );
}

function formatsOf(driver: MemoryDriver): readonly number[] {
  return driver.ports.runStore.events(drivenRunId).map(({ event }) => event.format);
}

describe('a run whose engine stops keeping values outside', () => {
  it('stays at format 12 and holds its new values inline, with an empty kept, while what it kept stays kept', () => {
    const driver = startedThenSwitched(true);

    nextPauseEnded(driver);
    const state = driver.state(drivenRunId);
    const inline = Object.values(state.machine.values).filter((held) => !isKept(held));

    expect(formatsOf(driver)).toEqual([12, 12]);
    expect(keptAlong(driver.ports.runStore.events(drivenRunId)).at(-1)).toEqual([]);
    expect(Math.max(...inline.map(({ bytes }) => bytes))).toBeGreaterThan(40_000);
  });

  it('writes no event of format 11 again once its log has one of format 12', () => {
    const driver = startedThenSwitched(true);

    nextPauseEnded(driver);
    nextPauseEnded(driver);

    expect(formatsOf(driver)).toEqual([12, 12, 12]);
  });
});

const acrossTheChange = workflow(`
do:
  - make: { set: '\${ "x".repeat(6000) }', export: { as: '\${ ({ first: $data }) }' } }
  - pause: { wait: PT1M }
  - again: { set: '\${ "y".repeat(7000) }' }
  - rest: { wait: PT1M }
`);

function startedUnder(payloadSizeThreshold: number, then: number): MemoryDriver {
  const driver = memoryDriver({ sandbox: testSandbox, payloadOffloading: true, payloadSizeThreshold });
  driver.start({ runId: drivenRunId, document: acrossTheChange });
  driver.ports.payloads.switchTo(true, then);
  nextPauseEnded(driver);
  return driver;
}

describe('a run whose engine is given another threshold while it runs', () => {
  it('keeps the arm of each value it already holds, and chooses a new value’s arm under the threshold it has now', () => {
    const lowered = startedUnder(65_536, 4096);
    const raised = startedUnder(4096, 65_536);

    expect(largeArmsOf(lowered)).toEqual([
      [
        [6002, false],
        [6012, false],
      ],
      [
        [6012, false],
        [7002, true],
      ],
    ]);
    expect(largeArmsOf(raised)).toEqual([
      [
        [6002, true],
        [6012, true],
      ],
      [
        [6012, true],
        [7002, false],
      ],
    ]);
  });

  it('writes format 12 throughout and loads to the state it reached, the threshold being no part of the format', () => {
    const lowered = startedUnder(65_536, 4096);
    const stream = lowered.ports.runStore.events(drivenRunId);

    expect(formatsOf(lowered)).toEqual([12, 12]);
    expect(loadedRunOf({ snapshot: null, tail: stream }).state).toEqual(lowered.state(drivenRunId));
  });
});

describe('a run whose engine starts keeping values outside', () => {
  it('crosses from format 11 to format 12 at its next event and loads across the crossing', () => {
    const driver = startedThenSwitched(false);

    nextPauseEnded(driver);
    const stream = driver.ports.runStore.events(drivenRunId);

    expect(formatsOf(driver)).toEqual([11, 12]);
    expect(keptAlong(stream).map((kept) => kept?.length)).toEqual([undefined, 1]);
    expect(loadedRunOf({ snapshot: null, tail: stream })).toMatchObject({ version: 2, format: 12 });
    expect(keptValuesIn(driver.state(drivenRunId))).toHaveLength(1);
  });
});

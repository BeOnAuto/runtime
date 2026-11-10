import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { pauseEnded } from '../kept-testing/kept-drivers.ts';
import { keptAlong, keptValuesIn } from '../kept-testing/kept-events.ts';
import { isKept } from '../machine/held-contents.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { loadedRunOf } from '../run-log/run-fold.ts';
import { memoryDriver, type MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const twice = workflow(`
do:
  - make: { set: '\${ "x".repeat(20000) }' }
  - pause: { wait: PT1M }
  - again: { set: '\${ ({ more: "y".repeat(20000), before: $data }) }' }
  - rest: { wait: PT1M }
`);

function startedThenSwitched(keepsPayloadsOutside: boolean): MemoryDriver {
  const driver = memoryDriver({ sandbox: testSandbox, keepsPayloadsOutside });
  driver.start({ runId: drivenRunId, document: twice });
  driver.ports.payloads.switchTo(!keepsPayloadsOutside);
  return driver;
}

function nextPauseEnded(driver: MemoryDriver): void {
  Effect.runSync(driver.engine.submit(pauseEnded(driver.state(drivenRunId))));
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

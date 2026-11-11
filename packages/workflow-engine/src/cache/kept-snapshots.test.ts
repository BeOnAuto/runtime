import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflowEngineOf } from '../engine/engine.ts';
import { testDriverOf, testMachine } from '../pool-testing/test-sandbox.ts';
import { startedOf } from '../testing/driver-inputs.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { runCacheOf } from './run-cache.ts';

const holdingMuch = workflow(`
do:
  - hold: { set: {}, export: { as: '\${ ({ much: "x".repeat(1200000) }) }' } }
  - tick: { wait: PT1S }
  - count: { set: '\${ ({ n: ($data.n ?? 0) + 1 }) }' }
  - again: { switch: [{ more: { when: '\${ $data.n < 5 }', then: tick } }] }
`);

describe('a run the engine keeps between its inputs, whose large value is kept outside', () => {
  it('keeps the text it kept across its snapshot, so no input after the snapshot reads it back', () => {
    const driver = testDriverOf({ keepsPayloadsOutside: true });
    driver.start({ runId: drivenRunId, document: holdingMuch });

    driver.runUntilEnded(drivenRunId);

    expect(driver.ports.runStore.snapshotsSaved(drivenRunId)).toEqual([1]);
    expect(driver.ports.runStore.events(drivenRunId).length).toBeGreaterThan(5);
    expect(driver.ports.payloads.keeps().flat()).toHaveLength(1);
    expect(driver.ports.payloads.reads()).toEqual([]);
  });
});

describe('a run its engine cannot keep between its inputs', () => {
  it('is snapshotted when it is due all the same, with nothing kept to put back', () => {
    const driver = testDriverOf();
    const engine = workflowEngineOf(driver.ports, testMachine, runCacheOf({ mostRuns: 0, mostBytes: 0 }));

    Effect.runSync(engine.submit(startedOf({ runId: drivenRunId, document: holdingMuch }, driver.clock.now())));

    expect(driver.ports.runStore.snapshotsSaved(drivenRunId)).toEqual([1]);
  });
});

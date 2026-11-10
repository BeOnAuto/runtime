import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { coldEngineOn, keptAnswer, largeAnswer, pauseEnded, waitingOnItsPause } from '../kept-testing/kept-drivers.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { ContentUnavailable } from '../run-log/content-unavailable.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

describe('a decision of a run whose held value is kept outside', () => {
  it('reads it once with the cold load before it decides, and not again while the run stays loaded', () => {
    const driver = waitingOnItsPause();
    const cold = coldEngineOn(driver.ports);

    const submitted = Effect.runSync(cold.submit(pauseEnded(driver.state(drivenRunId))));

    expect(submitted.outcome).toBe('applied');
    expect(driver.ports.payloads.reads()).toEqual([[keptAnswer]]);
    expect(JSON.stringify(driver.ports.runStore.events(drivenRunId).at(-1)?.event)).toContain('"length":30000');
  });

  it('fails as unavailable when the store cannot answer, appends nothing, and decides as if nothing happened when asked again', () => {
    const driver = waitingOnItsPause();
    const cold = coldEngineOn(driver.ports);
    const input = pauseEnded(driver.state(drivenRunId));
    const before = driver.ports.runStore.events(drivenRunId).length;
    driver.ports.payloads.failNext('read');

    const failed = Effect.runSyncExit(cold.submit(input));
    const appendedMeanwhile = driver.ports.runStore.events(drivenRunId).length - before;
    const again = Effect.runSync(cold.submit(input));
    const warm = waitingOnItsPause();
    Effect.runSync(warm.engine.submit(input));

    expect(failed).toEqual(
      Exit.fail(new ContentUnavailable({ detail: 'The store of payloads was told to fail its next read' })),
    );
    expect([appendedMeanwhile, again.outcome]).toEqual([0, 'applied']);
    expect(driver.ports.runStore.events(drivenRunId).at(-1)).toEqual(warm.ports.runStore.events(drivenRunId).at(-1));
  });
});

describe('a decision that keeps a new value outside', () => {
  it('fails as unavailable when the value cannot be kept, appending nothing, and is made when asked again', () => {
    const driver = memoryDriver({ sandbox: testSandbox, keepsPayloadsOutside: true });
    driver.ports.payloads.failNext('keep');
    const started = {
      kind: 'started',
      runId: drivenRunId,
      at: driver.clock.now(),
      document: workflow('do:\n  - pause: { wait: PT1M }'),
      input: largeAnswer,
      limits: { mostDurationMs: 600_000, longestCallMs: 1000 },
      attributes: {},
      seed: 1,
    } as const;

    const failed = Effect.runSyncExit(driver.engine.submit(started));
    const appendedMeanwhile = driver.ports.runStore.events(drivenRunId).length;

    expect(failed).toEqual(
      Exit.fail(new ContentUnavailable({ detail: 'The store of payloads was told to fail its next keep' })),
    );
    expect([appendedMeanwhile, Effect.runSync(driver.engine.submit(started)).outcome]).toEqual([0, 'applied']);
    expect(driver.ports.payloads.keeps()).toEqual([[keptAnswer]]);
  });
});

import { describe, expect, it } from 'vitest';

import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { memoryDriver } from './memory-driver.ts';
import { drivenRunId as runId } from './run-history.ts';
import { workflow } from './workflows.ts';

describe('the memory driver', () => {
  it('answers a call with null when it is given no responder', () => {
    const driver = memoryDriver({ sandbox: testSandbox });
    driver.start({ runId, document: workflow('do:\n  - ask: { call: notify, with: { to: ada } }') });

    expect(driver.runUntilEnded(runId).outcome).toEqual({ kind: 'completed', output: null });
  });

  it('waits for answers given later, between the steps of its clock', async () => {
    const driver = memoryDriver({
      sandbox: testSandbox,
      respond: () => ({ later: Promise.resolve({ status: 'succeeded', output: 'later' }) }),
    });
    driver.start({
      runId,
      document: workflow('do:\n  - pause: { wait: PT1M }\n  - ask: { call: notify, with: { to: ada } }'),
    });

    expect(await driver.outcomeOf(runId)).toEqual({ kind: 'completed', output: 'later' });
  });

  it('says so when a run does not end within the steps of its clock it is given', () => {
    const driver = memoryDriver({ sandbox: testSandbox, mostSteps: 5 });
    const retryingForever = workflow(`
do:
  - guarded:
      try: [{ fail: { raise: { error: { type: x, status: 503 } } } }]
      catch: { retry: { delay: PT1S } }
`);
    driver.start({ runId, document: retryingForever });

    expect(() => driver.runUntilEnded(runId)).toThrow(`The run ${runId} did not end within 5 steps of its clock`);
  });

  it('says so when a run waits for something that never comes', async () => {
    const driver = memoryDriver({ sandbox: testSandbox });
    driver.start({ runId, document: workflow('do:\n  - pause: { wait: PT1M }') });
    driver.ports.timers.forget();

    await expect(driver.outcomeOf(runId)).rejects.toThrow(`The run ${runId} waits for something that never comes`);
  });
});

describe('the memory driver as a clock and a log', () => {
  it('keeps every input it was given, applied or not, as the input log of each run', () => {
    const driver = memoryDriver({ sandbox: testSandbox });
    driver.start({ runId, document: workflow('do:\n  - pause: { wait: PT1M }') });
    driver.cancel(runId);
    driver.cancel(runId);

    expect(driver.inputsOf(runId).map(({ kind }) => kind)).toEqual(['started', 'cancel_requested', 'cancel_requested']);
    expect(driver.inputsOf('another')).toEqual([]);
  });

  it('runs what it was asked to do at a time on its clock', () => {
    const driver = memoryDriver({ sandbox: testSandbox });
    const done: number[] = [];
    driver.at(5000, () => {
      done.push(driver.clock.now());
    });
    driver.clock.advance();

    expect(done).toEqual([driver.clock.now()]);
  });
});

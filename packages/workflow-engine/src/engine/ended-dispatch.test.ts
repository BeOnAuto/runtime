import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import { workflow } from '../testing/workflows.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-000000000071';

const asking = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

function cancelledWhileItAsks(failing: 'cancel_call' | 'settle') {
  const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never' });
  driver.start({ runId, document: asking });
  driver.ports.faults.failNext(failing);
  driver.cancel(runId);
  return {
    watermark: Effect.runSync(driver.ports.watermark.read(runId)),
    settled: driver.ports.recordStore.settlementOf(runId),
  };
}

describe('the outputs of a run that has ended', () => {
  it('stop at a cancel of a call that fails, which is dispatched again, since the run it waits for must be cancelled', () => {
    expect(cancelledWhileItAsks('cancel_call')).toEqual({ watermark: 1, settled: undefined });
  });

  it('pass a start of a call that fails, which nothing can use once the run has ended', () => {
    const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never' });
    driver.ports.faults.failNext('start_call');
    driver.start({ runId, document: asking });
    driver.ports.faults.failNext('start_call');
    driver.cancel(runId);

    expect(Effect.runSync(driver.ports.watermark.read(runId))).toBe(2);
    expect(driver.ports.recordStore.settlementOf(runId)).toMatchObject({ status: 'rejected' });
  });

  it('stop at a settlement that fails, which is never passed', () => {
    expect(cancelledWhileItAsks('settle')).toEqual({ watermark: 1, settled: undefined });
  });
});

describe('the outputs of a run still going', () => {
  it('stop at a start of a call that fails, which is dispatched again', () => {
    const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never' });
    driver.ports.faults.failNext('start_call');
    driver.start({ runId, document: asking });

    expect(Effect.runSync(driver.ports.watermark.read(runId))).toBe(0);
    expect(Effect.runSync(driver.engine.wake(runId))).toEqual({ version: 1, dispatchedThrough: 1 });
  });
});

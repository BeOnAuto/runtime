import { sha256Of } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { coldEngineOn } from '../kept-testing/kept-drivers.ts';
import { argumentsPerformedBy } from '../kept-testing/kept-events.ts';
import type { MemoryPorts } from '../memory/memory-ports.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { memoryDriver, type MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const callArguments = { to: 'x'.repeat(20_000) };

const keptArguments = sha256Of(JSON.stringify(callArguments));

const asking = workflow(`do:\n  - ask: { call: notify, with: { to: '\${ "x".repeat(20000) }' } }`);

const askingTwice = workflow(`
do:
  - both:
      fork:
        branches:
          - a: { call: notify, with: { to: '\${ "x".repeat(20000) }' } }
          - b: { call: notify, with: { to: '\${ "x".repeat(20000) }' } }
`);

function startNotPerformed(): MemoryDriver {
  const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never', keepsPayloadsOutside: true });
  driver.ports.faults.failNext('start_call');
  driver.start({ runId: drivenRunId, document: asking });
  return driver;
}

function wokenCold(ports: MemoryPorts) {
  return Effect.runSync(coldEngineOn(ports).wake(drivenRunId));
}

describe('a start whose call’s arguments the run keeps outside', () => {
  it('is performed with the arguments read back from the store when it is dispatched again by a wake', () => {
    const driver = startNotPerformed();
    const before = argumentsPerformedBy(driver);

    const woken = wokenCold(driver.ports);

    expect(before).toEqual([]);
    expect(woken).toEqual({ version: 1, dispatchedThrough: 1 });
    expect(argumentsPerformedBy(driver)).toEqual([callArguments]);
    expect(driver.ports.payloads.reads()).toEqual([[keptArguments]]);
  });

  it('is a failed dispatch while the store cannot answer, holding the watermark, and is performed at the wake after', () => {
    const driver = startNotPerformed();
    driver.ports.payloads.failNext('read');

    const held = wokenCold(driver.ports);
    const after = wokenCold(driver.ports);

    expect([held.dispatchedThrough, after.dispatchedThrough]).toEqual([0, 1]);
    expect(argumentsPerformedBy(driver)).toEqual([callArguments]);
  });

  it.each(['missing', 'erased'] as const)(
    'is a failed dispatch while the arguments are %s; the next input ends the run, and the start is then passed over',
    (kind) => {
      const driver = startNotPerformed();
      driver.ports.payloads.lose(keptArguments, kind);
      const cold = coldEngineOn(driver.ports);

      const held = Effect.runSync(cold.wake(drivenRunId));
      Effect.runSync(
        cold.submit({
          kind: 'cancel_requested',
          runId: drivenRunId,
          at: driver.clock.now(),
          cancel: { by: 'tester', kind: 'requested', reason: 'stop' },
        }),
      );
      const ended = Effect.runSync(cold.wake(drivenRunId));

      expect([held.dispatchedThrough, ended.dispatchedThrough]).toEqual([0, 2]);
      expect(driver.state(drivenRunId).outcome).toMatchObject({ kind: 'raised', error: { status: 500 } });
      expect(argumentsPerformedBy(driver)).toEqual([]);
    },
  );
});

describe('two starts of one dispatch whose arguments are one kept text', () => {
  it('read it once, and are both performed with it', () => {
    const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never', keepsPayloadsOutside: true });
    driver.ports.faults.failNext('start_call');
    driver.start({ runId: drivenRunId, document: askingTwice });

    const woken = wokenCold(driver.ports);

    expect(woken).toEqual({ version: 1, dispatchedThrough: 1 });
    expect(argumentsPerformedBy(driver)).toEqual([callArguments, callArguments]);
    expect(driver.ports.payloads.reads()).toEqual([[keptArguments]]);
  });
});

describe('a start whose arguments the store or the engine holds otherwise', () => {
  it('is a failed dispatch when the store answers the read without the arguments, as it would when it cannot read them', () => {
    const driver = startNotPerformed();
    const answeringNothing = { ...driver.ports.payloads, read: () => Effect.succeed(new Map()) };

    const held = wokenCold({ ...driver.ports, payloads: answeringNothing });

    expect(held.dispatchedThrough).toBe(0);
    expect(argumentsPerformedBy(driver)).toEqual([]);
  });

  it('is performed with the text the engine holds for the run, which it kept or read whole, while the run stays loaded', () => {
    const driver = startNotPerformed();
    driver.ports.payloads.lose(keptArguments, 'missing');

    driver.cancel(drivenRunId);

    expect(argumentsPerformedBy(driver)).toEqual([callArguments]);
    expect(driver.state(drivenRunId).outcome).toMatchObject({ kind: 'cancelled' });
  });
});

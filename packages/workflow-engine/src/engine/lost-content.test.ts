import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { runCacheOf } from '../cache/run-cache.ts';
import { errorType } from '../dsl/raised-error.ts';
import { coldEngineOn, keptAnswer, pauseEnded, waitingOnItsPause } from '../kept-testing/kept-drivers.ts';
import type { RunState } from '../machine/run-state.ts';
import { testMachine, testWorkflowMachine } from '../pool-testing/test-sandbox.ts';
import { NoPayloadStore, noPayloadStore } from '../run-log/run-payloads.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflowEngineOf } from './engine.ts';

function endingOf(state: RunState, content: { readonly kind: 'missing' | 'erased' }) {
  return testWorkflowMachine.decision(pauseEnded(state), state, {
    contents: new Map([[keptAnswer, content]]),
    format: 12,
    payloadOffloading: true,
    payloadSizeThreshold: noPayloadStore.payloadSizeThreshold,
  }).events;
}

describe('a run whose held value kept outside is lost', () => {
  it.each([
    ['missing', 'is missing from the content it was kept in'],
    ['erased', 'was erased'],
  ] as const)('ends at its next input when the value is %s, naming its digest, and settles rejected', (kind, said) => {
    const driver = waitingOnItsPause();
    driver.ports.payloads.lose(keptAnswer, kind);

    const submitted = Effect.runSync(coldEngineOn(driver.ports).submit(pauseEnded(driver.state(drivenRunId))));
    const title = `A value the workflow holds, kept under ${keptAnswer}, ${said}`;
    const error = {
      type: errorType('runtime'),
      status: 500,
      title,
      instance: '/',
    };

    expect(submitted.outcome).toBe('applied');
    expect(driver.state(drivenRunId).outcome).toEqual({ kind: 'raised', error });
    expect(driver.ports.recordStore.settlementOf(drivenRunId)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
    });
  });

  it.each(['missing', 'erased'] as const)(
    'is ended by the same event every time the same input is decided with the value %s',
    (kind) => {
      const state = waitingOnItsPause().state(drivenRunId);

      expect(endingOf(state, { kind })).toEqual(endingOf(waitingOnItsPause().state(drivenRunId), { kind }));
      expect(endingOf(state, { kind })[0]?.outputs.at(-1)?.kind).toBe('settle');
    },
  );
});

describe('an engine composed with no store of payloads', () => {
  it('dies on a run that keeps a value outside, since nothing composed it to read one', () => {
    const driver = waitingOnItsPause();
    const { payloads: _ignored, ...without } = driver.ports;
    const engine = workflowEngineOf(without, testMachine, runCacheOf());

    const exit = Effect.runSyncExit(engine.submit(pauseEnded(driver.state(drivenRunId))));

    expect(exit).toEqual(Exit.die(new NoPayloadStore({ runId: drivenRunId })));
  });
});

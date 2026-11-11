import { sha256Of } from '@on.auto/content';

import { runCacheOf } from '../cache/run-cache.ts';
import { workflowEngineOf } from '../engine/engine.ts';
import type { RunInput, TimerFired } from '../machine/run-input.ts';
import type { ArmedTimer, RunState } from '../machine/run-state.ts';
import type { MemoryEngine, MemoryPorts } from '../memory/memory-ports.ts';
import { testMachine, testSandbox } from '../pool-testing/test-sandbox.ts';
import { memoryDriver, type MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

export const largeAnswer = { text: 'y'.repeat(30_000) };

export const keptAnswer = sha256Of(JSON.stringify(largeAnswer));

const askingThenPausing = workflow(`
do:
  - ask: { call: notify, with: { to: ada } }
  - pause: { wait: PT1M }
  - measure: { set: '\${ ({ length: $data.text.length }) }' }
`);

export function waitingOnItsPause(): MemoryDriver {
  const driver = memoryDriver({
    sandbox: testSandbox,
    respond: () => ({ after: 10, result: { status: 'succeeded', output: largeAnswer } }),
    keepsPayloadsOutside: true,
  });
  driver.start({ runId: drivenRunId, document: askingThenPausing });
  driver.clock.advance();
  return driver;
}

export function pauseEnded(state: RunState): RunInput {
  const timerId = String(state.timers.next - 1);
  return { kind: 'timer_fired', runId: state.runId, at: state.lastInputAt + 60_000, timerId };
}

export function coldEngineOn(ports: MemoryPorts): MemoryEngine {
  return workflowEngineOf(ports, testMachine, runCacheOf());
}

export function callDeadlinesFired(state: RunState): readonly TimerFired[] {
  return Object.entries(state.timers.armed)
    .filter(([, { purpose }]: readonly [string, ArmedTimer]) => purpose === 'call_deadline')
    .map(([timerId, { dueAt }]: readonly [string, ArmedTimer]) => ({
      kind: 'timer_fired',
      runId: state.runId,
      at: dueAt,
      timerId,
    }));
}

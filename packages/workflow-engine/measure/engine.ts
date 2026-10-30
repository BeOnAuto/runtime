import { Effect } from 'effect';

import { runCacheOf, type RunCache } from '../src/cache/run-cache.ts';
import { workflowEngineOf } from '../src/engine/engine.ts';
import type { RunInput } from '../src/machine/run-input.ts';
import { memoryPorts } from '../src/memory/memory-ports.ts';
import { virtualClock } from '../src/memory/virtual-clock.ts';
import { testMachine } from '../src/pool-testing/test-sandbox.ts';
import { startedOf } from '../src/testing/driver-inputs.ts';
import { runId, looping, millisecondsOf } from './common.ts';

function throughTheEngine(inputs: number, cache: RunCache): number {
  const clock = virtualClock();
  const ports = memoryPorts(
    clock,
    (input) => {
      submitted(input);
    },
    () => 'never',
  );
  const engine = workflowEngineOf(ports, testMachine, cache);
  function submitted(input: RunInput): void {
    Effect.runSync(engine.submit(input));
  }
  ports.recordStore.known(runId);
  return millisecondsOf(() => {
    submitted(startedOf({ runId, document: looping(inputs) }, clock.now()));
    let advancing = true;
    while (advancing) {
      advancing = clock.advance();
    }
  });
}

function engineLine(inputs: number, how: string, milliseconds: number): string {
  return `through the engine, ${inputs} inputs, ${how}: ${(milliseconds / 1000).toFixed(2)} s, ${(milliseconds / inputs).toFixed(2)} ms an input`;
}

export function engineMeasured(inputs: number): readonly string[] {
  const kept = throughTheEngine(inputs, runCacheOf());
  const loadedEveryTime = throughTheEngine(inputs, runCacheOf({ mostRuns: 0, mostBytes: 0 }));
  return [
    engineLine(inputs, 'the run kept between them', kept),
    engineLine(inputs, 'the run loaded for every input', loadedEveryTime),
  ];
}

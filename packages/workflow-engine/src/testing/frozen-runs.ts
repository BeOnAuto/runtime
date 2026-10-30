import { runCacheOf, type RunCache } from '../cache/run-cache.ts';
import type { EnginePorts } from '../engine/engine-ports.ts';
import { workflowEngineOf } from '../engine/engine.ts';
import type { WorkflowEngine } from '../engine/workflow-engine.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';

export function deeplyFrozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    const items: readonly unknown[] = Object.values(value);
    for (const item of items) {
      deeplyFrozen(item);
    }
  }
  return value;
}

export function frozenRuns(cache: RunCache): RunCache {
  return {
    ...cache,
    put: (runId, loaded) => {
      cache.put(runId, deeplyFrozen(loaded));
    },
  };
}

export function engineOfFrozenRuns(ports: EnginePorts, options: MachineOptions): WorkflowEngine {
  return workflowEngineOf(ports, options, frozenRuns(runCacheOf()));
}

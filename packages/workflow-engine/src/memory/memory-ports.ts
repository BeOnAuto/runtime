import type { EnginePorts } from '../engine/engine-ports.ts';
import type { WorkflowEngine } from '../engine/workflow-engine.ts';
import type { ContentUnavailable } from '../run-log/content-unavailable.ts';
import { memoryExecutor, type MemoryExecutor, type Responder } from './memory-executor.ts';
import { memoryPayloads, type MemoryPayloads } from './memory-payloads.ts';
import { memoryEmitter, memoryListeners, type MemoryEmitter, type MemoryListeners } from './memory-reactions.ts';
import {
  memoryRecordStore,
  memoryReporter,
  memoryWatermark,
  type MemoryRecordStore,
  type MemoryReporter,
} from './memory-records.ts';
import { faultsOf, memoryTimers, type Faults, type MemoryTimers, type Submit } from './memory-timers.ts';
import { memoryRunStore, type MemoryRunStore } from './run-store.ts';
import type { VirtualClock } from './virtual-clock.ts';

export interface MemoryPorts extends EnginePorts<ContentUnavailable> {
  readonly runStore: MemoryRunStore;
  readonly payloads: MemoryPayloads;
  readonly timers: MemoryTimers;
  readonly executor: MemoryExecutor;
  readonly listeners: MemoryListeners;
  readonly emitter: MemoryEmitter;
  readonly recordStore: MemoryRecordStore;
  readonly reporter: MemoryReporter;
  readonly faults: Faults;
}

export type MemoryEngine = WorkflowEngine<ContentUnavailable>;

export function memoryPorts(
  clock: VirtualClock,
  submit: Submit,
  responder: Responder,
  keepsPayloadsOutside = false,
): MemoryPorts {
  const faults = faultsOf(clock);
  const runStore = memoryRunStore();
  return {
    runStore,
    payloads: memoryPayloads(keepsPayloadsOutside),
    watermark: memoryWatermark(runStore),
    timers: memoryTimers(clock, submit, faults),
    executor: memoryExecutor(clock, submit, responder, faults),
    listeners: memoryListeners(faults),
    emitter: memoryEmitter(faults),
    recordStore: memoryRecordStore(faults),
    reporter: memoryReporter(),
    serialiser: { serialise: (_runId, work) => work },
    faults,
  };
}

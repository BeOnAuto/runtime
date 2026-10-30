import type { EnginePorts } from '../engine/engine-ports.ts';
import { memoryExecutor, type MemoryExecutor, type Responder } from './memory-executor.ts';
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

export interface MemoryPorts extends EnginePorts {
  readonly runStore: MemoryRunStore;
  readonly timers: MemoryTimers;
  readonly executor: MemoryExecutor;
  readonly listeners: MemoryListeners;
  readonly emitter: MemoryEmitter;
  readonly recordStore: MemoryRecordStore;
  readonly reporter: MemoryReporter;
  readonly faults: Faults;
}

export function memoryPorts(clock: VirtualClock, submit: Submit, responder: Responder): MemoryPorts {
  const faults = faultsOf(clock);
  const runStore = memoryRunStore();
  return {
    runStore,
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

import type { DispatchWatermark } from '../dispatch/dispatch-watermark.ts';
import type { Executor } from '../executor/executor.ts';
import type { Emitter, Listeners } from '../reactions/reaction-ports.ts';
import type { RunLogStore } from '../run-log/run-store.ts';
import type { RunSerialiser } from '../serialisation/run-serialiser.ts';
import type { RecordStore, RunReporter } from '../settlement/record-store.ts';
import type { Timers } from '../timers/timers.ts';

export interface EnginePorts {
  readonly runStore: RunLogStore;
  readonly watermark: DispatchWatermark;
  readonly timers: Timers;
  readonly executor: Executor;
  readonly listeners: Listeners;
  readonly emitter: Emitter;
  readonly recordStore: RecordStore;
  readonly reporter: RunReporter;
  readonly serialiser: RunSerialiser;
}

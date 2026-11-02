import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import { makeMemoryFunctionAdapter, memoryOperationsOf, type MemoryOperations } from '@on.auto/memory';
import type { DispatcherServices } from '@on.auto/operations';

import { runtimeLedger } from './runtime-ledger.ts';

export interface ServedMemory {
  readonly capability: Capability;
  readonly operations: MemoryOperations;
}

export function memoryServedBy(runtime: AppRuntime<DispatcherServices>): ServedMemory {
  const memories = { ledger: runtimeLedger(runtime) };
  return { capability: makeMemoryFunctionAdapter(memories), operations: memoryOperationsOf(memories) };
}

export type { MemoryFunctionDefinitionDocument } from './document/memory-document.ts';
export { memoryBounds } from './document/memory-bounds.ts';
export { makeMemoryFunctionAdapter } from './capability/memory-function.ts';
export type { MemoryFunctionAdapterOptions } from './capability/memory-ports.ts';
export { memoryKeeperOn } from './keeper/kept-in-a-ledger.ts';
export type {
  Acting,
  ForgottenStatus,
  MarkedMoved,
  MemoryKeeper,
  MemoryLedger,
  RememberAsk,
} from './keeper/memory-keeper.ts';
export type { MemoryStatus } from './facts/memory-decider.ts';
export type { MemoryScope } from './facts/memory-facts.ts';
export type { MemoryAt } from './facts/memory-streams.ts';
export { memoryDefinitionType } from './capability/memory-run.ts';
export { MemoryFactSchema } from './facts/memory-fact-schema.ts';
export { memoryOperationsOf, type MemoryOperations } from './operations/memory-operations.ts';
export { memoryLayoutSteps } from './projection/memory-layout.ts';
export { memoriesName, memoryRows } from './projection/memory-rows.ts';

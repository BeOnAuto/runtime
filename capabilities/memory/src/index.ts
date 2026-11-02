export type { MemoryFunctionDefinitionDocument } from './document/memory-document.ts';
export { memoryBounds } from './document/memory-bounds.ts';
export { makeMemoryFunctionAdapter } from './capability/memory-function.ts';
export type { MemoryFunctionAdapterOptions, MemoryLedger } from './capability/memory-ports.ts';
export { memoryDefinitionType } from './capability/memory-run.ts';
export { MemoryFactSchema } from './facts/memory-fact-schema.ts';
export { memoryOperationsOf, type MemoryOperations } from './operations/memory-operations.ts';
export { memoryLayoutSteps } from './projection/memory-layout.ts';
export { memoriesName, memoryRows } from './projection/memory-rows.ts';

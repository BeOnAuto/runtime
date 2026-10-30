import { mostResultBytes } from '@on.auto/definitions';
import { mostValueDepth, runMemoryBytes, workerStackBytes } from '@on.auto/workflow-engine/dsl';

export const computationBounds = {
  budget: 20_000,
  deadlineMs: 10_000,
  memoryBytes: runMemoryBytes,
  stackBytes: workerStackBytes,
  heapMegabytes: 256,
  workers: 4,
  mostValueDepth,
} as const;

const recordRoomBytes = 256;

export const mostOutputBytes = mostResultBytes - recordRoomBytes;

export const mebibytes = 1_048_576;

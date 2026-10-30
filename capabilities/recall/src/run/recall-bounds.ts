import { checkedWorker, mostResultBytes } from '@on.auto/definitions';
import { mostValueDepth, runMemoryBytes, unitMemoryBytes, workerStackBytes } from '@on.auto/workflow-engine/dsl';
import type { FoldingSettings } from '@on.auto/workflow-host';

export const recallBounds = {
  mostFilters: 8,
  budget: 500,
  foldDeadlineMs: 10_000,
  deadlineMs: 10_000,
  answerMemoryBytes: runMemoryBytes,
  foldMemoryBytes: unitMemoryBytes,
  stackBytes: workerStackBytes,
  heapMegabytes: 256,
  mostViewBytes: 524_288,
  mostValueDepth,
  overtimesBeforeStall: 20,
  pageBudgetMs: 2000,
  pagesPerWake: 10,
  mostFunctions: 32,
  rebuildsAtOnce: 4,
  playbooksAtOnce: 4,
} as const;

const recordRoomBytes = 2048;

export const mostOutputBytes = mostResultBytes - recordRoomBytes;

export const mebibytes = 1_048_576;

export const recallFolding: FoldingSettings = {
  budget: recallBounds.budget,
  memoryBytes: recallBounds.foldMemoryBytes,
  stackBytes: recallBounds.stackBytes,
  foldDeadlineMs: recallBounds.foldDeadlineMs,
  pageBudgetMs: recallBounds.pageBudgetMs,
  mostViewBytes: recallBounds.mostViewBytes,
  worker: checkedWorker,
};

export const recallDefinitionType = 'recall';

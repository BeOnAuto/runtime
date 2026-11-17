import type { ModuleAddress, ProgramPool } from '@on.auto/workflow-engine/dsl';

export interface FoldingSettings {
  readonly budget: number;
  readonly memoryBytes: number;
  readonly stackBytes: number;
  readonly foldDeadlineMs: number;
  readonly pageBudgetMs: number;
  readonly mostViewBytes: number;
  readonly worker?: ModuleAddress;
  readonly pageMarginMs?: number;
}

export interface ViewsFolding {
  readonly definitionType: string;
  readonly pool: ProgramPool;
  readonly folding: FoldingSettings;
  readonly overtimesBeforeStall: number;
  readonly rebuildsAtOnce: number;
}

export const waitForAWorkerMs = 10_000;

const marginOfAPageMs = 5000;

export function pageDeadlineMs({
  foldDeadlineMs,
  pageBudgetMs,
  pageMarginMs = marginOfAPageMs,
}: FoldingSettings): number {
  return pageBudgetMs + foldDeadlineMs + pageMarginMs;
}

export function shareOfThePool({ workers }: Pick<ProgramPool, 'workers'>): number {
  return Math.max(1, Math.floor(workers / 2));
}

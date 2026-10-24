import type { Json } from '../dsl/json.ts';
import type { FoldPage } from '../folds/fold-page.ts';
import type { FoldPlace } from '../folds/fold-progress.ts';
import type { InstanceSourceName } from '../instances/instance-sources.ts';
import type { CheckAnswer, CheckJob } from './check-messages.ts';
import type { FoldAnswer } from './fold-messages.ts';
import type { Ending, Interrupted } from './job-endings.ts';
import type { ProgramAnswer } from './program-messages.ts';
import type { Evaluations } from './remote-evaluations.ts';

export type ModuleAddress = () => Readonly<URL>;

export type HandedFiles = Readonly<Record<string, Readonly<Uint8Array>>>;

export interface HandedWorkers {
  readonly sandbox: HandedFiles;
  readonly modules?: Readonly<Record<string, HandedFiles>>;
}

export interface PoolSettings {
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly handed: HandedWorkers;
  readonly instances: InstanceSourceName;
  readonly worker?: ModuleAddress;
  readonly foldWorker?: ModuleAddress;
  readonly evaluationWorker?: ModuleAddress;
  readonly environment?: Readonly<Record<string, string>>;
  readonly idleMs?: number;
  readonly checkStartMs?: number;
  readonly jobsPerWorker?: number;
}

export interface ProgramRequest {
  readonly source: string;
  readonly entry: string;
  readonly arguments: readonly Json[];
  readonly moment: number;
  readonly budget: number;
  readonly memoryBytes: number;
  readonly stackBytes: number;
  readonly deadlineMs: number;
  readonly mostOutputBytes: number;
  readonly worker?: ModuleAddress;
  readonly context?: Json;
}

export type PoolOutcome = Ending<ProgramAnswer> & { readonly milliseconds: number };

export interface FoldRequest extends FoldPage {
  readonly waitMs: number;
  readonly deadlineMs: number;
  readonly worker?: ModuleAddress;
}

export type FoldEnding = FoldAnswer | (Interrupted & { readonly progress?: FoldPlace });

export type FoldOutcome = FoldEnding & { readonly milliseconds: number };

export interface CheckRequest extends CheckJob {
  readonly deadlineMs: number;
  readonly worker: ModuleAddress;
}

export type CheckOutcome = Ending<CheckAnswer> & { readonly milliseconds: number };

export interface ProgramPool {
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly run: (request: ProgramRequest, signal?: Readonly<AbortSignal>) => Promise<PoolOutcome>;
  readonly fold: (request: FoldRequest, signal?: Readonly<AbortSignal>) => Promise<FoldOutcome>;
  readonly check: (request: CheckRequest, signal?: Readonly<AbortSignal>) => Promise<CheckOutcome>;
  readonly evaluations: Evaluations;
  readonly close: () => Promise<void>;
}

import type {
  CallerIdentity,
  CallLink,
  Lineage,
  PlaybookAddress,
  ProjectionAdvancer,
  ProjectionReader,
  RecordedContent,
  RecordedReader,
  StreamReader,
  StreamWriter,
} from '@on.auto/operations';
import type { ModelRuntime } from '@on.auto/prediction-contract';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import type { HostDatabase } from '@on.auto/workflow-host';
import type { Effect, Schema } from 'effect';

import type { DatasetsPort } from '../dataset/datasets-port.ts';
import type { FileCache, NamedFileCache } from '../model-cache/model-files.ts';
import type { ParsedRows } from '../model-cache/parsed-rows.ts';
import type { ModelProcesses } from '../model-processes/model-processes.ts';
import type { ScoringPermits } from '../model-processes/scoring-permits.ts';

export interface PredictionLedger
  extends StreamReader, StreamWriter, Pick<RecordedReader, 'readRecorded'>, ProjectionReader, ProjectionAdvancer {
  readonly content: RecordedContent;
}

export interface ChildStart {
  readonly org: string;
  readonly playbook: string;
  readonly caller: CallerIdentity;
  readonly type: string;
  readonly name: string;
  readonly input: Schema.Json;
  readonly runId: string;
  readonly lineage: Lineage;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy: CallLink;
}

export type ChildStarted =
  | { readonly status: 'rejected'; readonly detail: string }
  | { readonly status: 'succeeded' | 'waiting' | 'failed' };

export type StartChild = (start: ChildStart) => Effect.Effect<ChildStarted>;

export interface ModelCaches {
  readonly models: FileCache;
  readonly rows: NamedFileCache;
  readonly parsed: ParsedRows;
}

export interface BuildBounds {
  readonly buildsPerDay: number;
  readonly buildsAtOnce: number;
  readonly mostOpenRequests: number;
}

export interface PredictionPorts {
  readonly ledger: PredictionLedger;
  readonly database: Pick<HostDatabase, 'readConsistently'>;
  readonly runtimes: readonly ModelRuntime[];
  readonly models: ModelProcesses;
  readonly caches: ModelCaches;
  readonly permits: ScoringPermits;
  readonly bounds: BuildBounds;
  readonly openRequests: (playbook: PlaybookAddress) => Effect.Effect<number>;
}

export interface PredictionFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly datasets: DatasetsPort;
  readonly ports: PredictionPorts;
  readonly mostFunctions?: number;
}

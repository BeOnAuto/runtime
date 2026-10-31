import type {
  Capability,
  CapabilityAnswer,
  CapabilityRejection,
  PreparedDefinition,
  RunContext,
} from '@on.auto/definitions';
import {
  checkingWithin,
  measuredPoolSettings,
  noCalledDefinitions,
  onTheStandingClock,
  recordingJournal,
} from '@on.auto/definitions/testing';
import { allPermissions } from '@on.auto/operations';
import { programPool, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect, type Exit, type Schema } from 'effect';
import { afterEach } from 'vitest';

import { predictionFunctionOf, type PredictionFunctionParts } from '../capability/prediction-function.ts';
import type { DatasetRow } from '../dataset/dataset-rows.ts';
import type { DatasetsPort } from '../dataset/datasets-port.ts';

const pools: ProgramPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

export function poolOf(): ProgramPool {
  const pool = programPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });
  pools.push(pool);
  return checkingWithin(pool);
}

const forecastRun: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', name: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { name: 'weekly-orders', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
};

interface KeptDatasets extends DatasetsPort {
  readonly keep: (dataSha256: string, row: DatasetRow) => void;
}

function keptDatasets(): KeptDatasets {
  const kept = new Map<string, DatasetRow>();
  return {
    keep: (dataSha256, row) => {
      kept.set(dataSha256, row);
    },
    datasetOf: (_playbook, dataSha256) => Effect.sync(() => kept.get(dataSha256)),
  };
}

const noDatasetRows: PredictionFunctionParts['database'] = {
  readConsistently: (reads) => reads(() => Effect.succeed([])),
};

export interface PredictionRuns {
  readonly capability: Capability;
  readonly datasets: KeptDatasets;
  readonly prepared: (source: string) => PreparedDefinition;
  readonly running: (source: string, input: Schema.Json) => Promise<Exit.Exit<CapabilityAnswer, CapabilityRejection>>;
  readonly refusing: (source: string, input: Schema.Json) => Promise<CapabilityRejection>;
}

function preparedOnTheStandingClock(definition: PreparedDefinition): PreparedDefinition {
  return {
    ...definition,
    check: (place) => onTheStandingClock(definition.check(place)),
    run: (input, context) => onTheStandingClock(definition.run(input, context)),
  };
}

export function predictionRuns(pool: ProgramPool = poolOf(), mostFunctions?: number): PredictionRuns {
  const datasets = keptDatasets();
  const capability = predictionFunctionOf({
    pool,
    database: noDatasetRows,
    datasets,
    ...(mostFunctions === undefined ? {} : { mostFunctions }),
  });
  const prepared = (source: string) => preparedOnTheStandingClock(Effect.runSync(capability.prepare(source)));
  return {
    capability,
    datasets,
    prepared,
    running: (source, input) => Effect.runPromiseExit(prepared(source).run(input, forecastRun)),
    refusing: (source, input) => Effect.runPromise(Effect.flip(prepared(source).run(input, forecastRun))),
  };
}

import type { CapabilityAnswer, PreparedDefinition, Capability, RunContext } from '@on.auto/definitions';
import {
  checkingWithin,
  checksAwaitedAtMostMs,
  noLongestRuns,
  nothingSaved,
  recordingJournal,
} from '@on.auto/definitions/testing';
import { allPermissions, type Conflict, type InvalidInput, type Unavailable } from '@on.auto/operations';
import { programPool, type FoldRequest, type PoolSettings, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import type { KeptView } from '@on.auto/workflow-host';
import { Effect, type Exit, type Schema } from 'effect';
import { afterEach } from 'vitest';

import { makeRecallFunctionAdapter, type RecallFunctionAdapterOptions } from '../capability/recall-function.ts';
import { recallBounds } from '../run/recall-bounds.ts';
import { keptViews, type KeptViews } from './kept-views.ts';

const reviewsRun: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { name: 'reviews', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  ...noLongestRuns,
};

type Run = Exit.Exit<CapabilityAnswer, InvalidInput | Unavailable | Conflict>;

export interface RecallRuns extends KeptViews {
  readonly capability: Capability;
  readonly prepared: (source: string) => PreparedDefinition;
  readonly running: (source: string, input?: Schema.Json) => Promise<Run>;
  readonly runningUnsaved: (source: string, input?: Schema.Json) => Promise<Run>;
}

const pools: ProgramPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

const measured: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(process.env).flatMap(([key, value]: readonly [string, string | undefined]) =>
    key === 'NODE_V8_COVERAGE' && value !== undefined ? [[key, value]] : [],
  ),
);

export function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({
    workers: 2,
    heapMegabytes: recallBounds.heapMegabytes,
    environment: measured,
    ...settings,
  });
  pools.push(pool);
  return checkingWithin(pool);
}

export const patientPage: Pick<FoldRequest, 'pageBudgetMs' | 'waitMs' | 'deadlineMs'> = {
  pageBudgetMs: checksAwaitedAtMostMs,
  waitMs: checksAwaitedAtMostMs,
  deadlineMs: checksAwaitedAtMostMs,
};

export function liveView(view: Schema.Json, more: Partial<KeptView> = {}): KeptView {
  return {
    name: 'reviews',
    version: 1,
    phase: 'live',
    view,
    checkpoint: 'YnJhaW4vYWNtZS9hbHBoYS8sNDI',
    checkpointAt: '2026-10-06T10:00:05.000Z',
    lastEvent: { id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1b', time: '2026-10-06T10:00:04.000Z' },
    folded: 5,
    ...more,
  };
}

export type AnswerBounds = Pick<RecallFunctionAdapterOptions, 'deadlineMs' | 'budget' | 'memoryBytes'>;

export function recallWith(pool: ProgramPool = poolOf(), bounds: AnswerBounds = {}): RecallRuns {
  const views = keptViews();
  const capability = makeRecallFunctionAdapter({ pool, views: views.views, ...bounds });
  const prepared = (source: string): PreparedDefinition => Effect.runSync(capability.prepare(source));
  const saved = (source: string) =>
    Effect.flatMap(prepared(source).check(nothingSaved), (stripped) => capability.prepare(source, stripped));
  return {
    ...views,
    capability,
    prepared,
    running: (source, input = {}) =>
      Effect.runPromiseExit(Effect.flatMap(saved(source), (definition) => definition.run(input, reviewsRun))),
    runningUnsaved: (source, input = {}) => Effect.runPromiseExit(prepared(source).run(input, reviewsRun)),
  };
}

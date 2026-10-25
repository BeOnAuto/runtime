import type {
  CapabilityAnswer,
  CapabilityRejection,
  PreparedDefinition,
  Capability,
  RunContext,
} from '@on.auto/definitions';
import {
  checkingWithin,
  measuredPoolSettings,
  noCalledDefinitions,
  nothingSaved,
  recordingJournal,
} from '@on.auto/definitions/testing';
import { allPermissions } from '@on.auto/operations';
import { programPool, type PoolSettings, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect, type Exit, type Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach } from 'vitest';

import {
  makeComputationFunctionAdapter,
  type ComputationFunctionAdapterOptions,
} from '../capability/computation-function.ts';
import { computationBounds } from '../run/run-bounds.ts';

const run: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { name: 'pace', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
};

export type Run = Exit.Exit<CapabilityAnswer, CapabilityRejection>;

export interface ComputationRuns {
  readonly capability: Capability;
  readonly prepared: (source: string) => PreparedDefinition;
  readonly running: (source: string, input?: Schema.Json) => Promise<Run>;
  readonly runningUnsaved: (source: string, input?: Schema.Json) => Promise<Run>;
  readonly runningAt: (moment: number, source: string, input?: Schema.Json) => Promise<Run>;
}

const pools: ProgramPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

export function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({
    workers: computationBounds.workers,
    heapMegabytes: computationBounds.heapMegabytes,
    ...measuredPoolSettings,
    ...settings,
  });
  pools.push(pool);
  return checkingWithin(pool);
}

export type RunBounds = Omit<ComputationFunctionAdapterOptions, 'pool'>;

const runsAwaitedAtMostMs = 30_000;

export function computationWith(pool: ProgramPool = poolOf(), bounds: RunBounds = {}): ComputationRuns {
  const capability = makeComputationFunctionAdapter({ pool, deadlineMs: runsAwaitedAtMostMs, ...bounds });
  const prepared = (source: string): PreparedDefinition => Effect.runSync(capability.prepare(source));
  const saved = (source: string) =>
    Effect.flatMap(prepared(source).check(nothingSaved), (stripped) => capability.prepare(source, stripped));
  return {
    capability,
    prepared,
    running: (source, input = {}) =>
      Effect.runPromiseExit(Effect.flatMap(saved(source), (definition) => definition.run(input, run))),
    runningUnsaved: (source, input = {}) => Effect.runPromiseExit(prepared(source).run(input, run)),
    runningAt: (moment, source, input = {}) =>
      Effect.runPromiseExit(
        Effect.flatMap(saved(source), (definition) =>
          TestClock.setTime(moment).pipe(Effect.andThen(definition.run(input, run)), Effect.provide(TestClock.layer())),
        ),
      ),
  };
}

export function programDocument(program: string, frontMatter = 'language: typescript'): string {
  return `---\n${frontMatter}\n---\n${program}`;
}

export function functionOf(body: string): string {
  return `export default function (input: any): any {\n  ${body}\n}`;
}

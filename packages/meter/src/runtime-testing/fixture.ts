import { computationBounds, makeComputationFunctionAdapter } from '@on.auto/computation';
import {
  defineCreateDefinition,
  defineRunDefinition,
  defineUpdateDefinition,
  RunAdmission,
  type PlaybookOperation,
  type RunDispatch,
} from '@on.auto/definitions';
import { allPermissions, Ledger, makeDispatcher, type CallerIdentity } from '@on.auto/operations';
import { memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer, type Schema } from 'effect';
import { expect } from 'vitest';

import { selfHostedRuns, type RuntimeRuns } from '../index.ts';
import { selfHostedFixture } from '../self-hosted-testing/fixture.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';
import { runtimePool } from './pool.ts';

export const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';
export const source =
  '---\nlanguage: typescript\ninput: {schema: {type: object}}\n---\nexport default function (input: any): any { return { doubled: input.value * 2 }; }';
const place = { org: 'acme', playbook: 'alpha' };
const caller: CallerIdentity = {
  id: 'owner-1',
  name: 'Owner',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};
const defaultInput = { value: 3 };
const bounds = { deadlineMs: 30_000, budget: 20_000, memoryBytes: computationBounds.memoryBytes };
const limits = { computation: bounds, recall: bounds };

export function dispatchRequest(changes: Partial<RunDispatch> = {}): RunDispatch {
  return {
    ...place,
    caller,
    runId,
    definition: { type: 'computation', name: 'double', version: 1, source },
    input: { value: 3 },
    calledBy: null,
    trigger: null,
    ...changes,
  };
}

function computationRuntime(runs: RuntimeRuns, ledger: Ledger['Service'], pool: ReturnType<typeof runtimePool>) {
  const capability = makeComputationFunctionAdapter({ pool, ...bounds });
  const create = defineCreateDefinition([capability]);
  const update = defineUpdateDefinition([capability]);
  const run = defineRunDefinition([capability]);
  const reporter = recordingReporter();
  const services = Layer.mergeAll(
    Layer.succeed(Ledger, ledger),
    Layer.succeed(RunAdmission, runs.admission),
    memoryPlaybookRegistry([place]),
    reporter.layer,
  );
  const dispatcher = makeDispatcher([]);
  const call = (operation: PlaybookOperation, body: Readonly<Record<string, unknown>>) =>
    Effect.runPromise(
      dispatcher
        .dispatchToPlaybook(operation.registration, { ...place, caller, input: body, encoding: 'json' })
        .pipe(Effect.provide(services)),
    );
  return {
    define: () => call(create, { type: 'computation', name: 'double', source }),
    update: (next: string) => call(update, { type: 'computation', name: 'double', source: next }),
    run: (id = runId, input: Schema.Json = defaultInput) =>
      call(run, { type: 'computation', name: 'double', run_id: id, input }),
    reported: reporter.reported,
  };
}

export async function runtimeFixture(open = sqliteDatabase) {
  const f = await selfHostedFixture(open, ['computation', 'recall']);
  const options = { connection: f.options.connection, meter: f.meter, limits };
  const runs = selfHostedRuns(options);
  const underlying = runtimePool();
  const dispatched: string[] = [];
  const pool: ReturnType<typeof runtimePool> = {
    ...underlying,
    run: (request, signal) => {
      dispatched.push(request.source);
      return underlying.run(request, signal);
    },
  };
  const runtime = computationRuntime(runs, f.database.ledger, pool);
  expect(await runtime.define()).toMatchObject({ status: 'succeeded' });
  return {
    ...f,
    runOptions: options,
    runs,
    runtime,
    runtimeWith: (next: RuntimeRuns) => computationRuntime(next, f.database.ledger, pool),
    dispatched,
    reconcile: () => runs.reconcile({ reader: f.database.ledger }),
  };
}

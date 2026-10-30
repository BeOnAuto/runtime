import { makeAppRuntime } from '@on.auto/api';
import { defineCapability, type PlaybookOperation } from '@on.auto/definitions';
import { licensedFeaturesOf } from '@on.auto/meter';
import { statement, type CapabilityDatabase, type DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PortsOfTheServer } from '../extensions/capability-points.ts';
import { sharedWorkerPool } from '../testing/servers/worker-pools.ts';
import { providedOnceServed } from './served-ports.ts';

const pool = sharedWorkerPool();

const capability = defineCapability({
  type: 'prediction',
  title: 'Prediction',
  guide: { name: 'prediction-function' },
  noun: { one: 'prediction function', other: 'prediction functions' },
  describeOutput: () => 'Answered.',
  mediaType: 'text/markdown',
  parse: (source) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.succeed({ output: null, record: {} }),
});

const dueWork: DueWork = { name: 'forecasts', due: () => Effect.succeed([]), nextDueAt: () => Effect.succeed(null) };

const operations: readonly PlaybookOperation[] = [];

function databaseAnswering(answer: string): CapabilityDatabase {
  const rows = () => Effect.succeed([answer]);
  return { read: rows, write: rows, transaction: rows, readConsistently: (reads) => reads(rows) };
}

describe('the ports the server hands a capability it makes before its database opens', () => {
  it('answer from the database and the features of the license once the server serves them', async () => {
    const { promise: handed, resolve } = Promise.withResolvers<PortsOfTheServer>();
    const { provided, servedIn } = providedOnceServed(
      (ports) => {
        resolve(ports);
        return { capability, operations, dueWork: [dueWork] };
      },
      { pool, mostFunctions: 3, triesBeforeStall: 2 },
    );
    const { database, features, mostFunctions } = await handed;
    const answers = Effect.all([
      database.read(statement`SELECT 1`),
      database.write(statement`SELECT 1`),
      database.transaction([]),
      database.readConsistently((read) => read(statement`SELECT 1`)),
      features.includes({ org: 'acme', feature: 'forecasts' }),
      features.refusal({ org: 'acme', feature: 'forecasts', which: 'forecasts' }),
    ]);

    const answered = Effect.runPromise(answers);
    const runtime = await makeAppRuntime(licensedFeaturesOf(() => Effect.succeed(['forecasts'])));
    await servedIn(runtime, databaseAnswering('served'));
    const [read, written, transacted, readConsistently, included, refusal] = await answered;
    await runtime.dispose();

    expect([[read, written, transacted, readConsistently, included], refusal.detail, mostFunctions, provided]).toEqual([
      [['served'], ['served'], ['served'], ['served'], true],
      expect.stringContaining('forecasts'),
      3,
      { capability, folders: [], operations, dueWork: [dueWork] },
    ]);
  });
});

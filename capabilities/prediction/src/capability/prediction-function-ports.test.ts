import { pageFiltersOn } from '@on.auto/workflow-engine';
import type { CapabilityPorts, Statement } from '@on.auto/workflow-host';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { datasetTables } from '../dataset/dataset-statements.ts';
import { parsePredictionDocument } from '../document/document-parsing.ts';
import { poolOf } from '../testing/prediction-runs.ts';
import { weeklyOrders } from '../testing/weekly-orders.ts';
import { datasetDetailsOf } from './prediction-definitions.ts';
import { makePredictionFunctionAdapter } from './prediction-function.ts';

const aWaitingDataset: unknown = expect.objectContaining({ phase: 'waiting', rows: 0 });

interface Reading {
  readonly ports: CapabilityPorts;
  readonly read: readonly Statement[];
}

function portsReading(): Reading {
  const read: Statement[] = [];
  const noRows = (statement: Statement) =>
    Effect.sync(() => {
      read.push(statement);
      return [];
    });
  const pool = poolOf();
  const ports: CapabilityPorts = {
    database: {
      read: noRows,
      write: noRows,
      transaction: () => Effect.succeed([]),
      readConsistently: (reads) => reads(noRows),
    },
    pool,
    filters: pageFiltersOn(pool.evaluations.filters),
    features: { includes: () => Effect.succeed(false), refusal: () => Effect.die('No feature is asked') },
    settings: new Map(),
    mostFunctions: 5,
    triesBeforeStall: 3,
  };
  return { ports, read };
}

describe('the prediction capability made from the ports the runtime hands a capability', () => {
  it('reads the standing of its dataset from the host database of the ports, and keeps the functions they allow', async () => {
    const { ports, read } = portsReading();
    const { capability } = makePredictionFunctionAdapter(ports);
    const details = datasetDetailsOf(Result.getOrThrow(parsePredictionDocument(weeklyOrders)));

    const standing = await Effect.runPromise(
      capability.standing({
        org: 'acme',
        playbook: 'alpha',
        name: 'weekly-orders',
        version: 1,
        status: 'active',
        details,
      }),
    );

    expect([capability.mostActive, read.length, standing]).toEqual([5, 1, { dataset: aWaitingDataset }]);
  });

  it('provides the folder of its datasets, whose tables are the ones it names', () => {
    const { folders = [] } = makePredictionFunctionAdapter(portsReading().ports);
    const tables = folders.flatMap((some) => some((folder) => folder.tables.map(({ strings }) => strings.join('?'))));

    expect(folders.map((some) => some((folder) => folder.definitionType))).toEqual(['prediction']);
    expect(
      tables.map((created) => /^CREATE TABLE IF NOT EXISTS (?<name>\w+) /u.exec(created)?.groups?.['name']),
    ).toEqual([datasetTables.datasets, datasetTables.rows]);
  });
});

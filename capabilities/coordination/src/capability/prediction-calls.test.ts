import { measuredPoolSettings } from '@on.auto/definitions/testing';
import { memoryLedger } from '@on.auto/operations/testing';
import { makePredictionFunctionAdapter } from '@on.auto/prediction';
import { weeklyOrders } from '@on.auto/prediction/testing';
import { pageFiltersOn, programPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { callMarginMs } from '../runs/call-limits.ts';
import { playbookOn } from '../testing/playbook.ts';
import { recordingStarts, recordingWorkflows } from '../testing/recording-starts.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-555555555553';

const pool = programPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });

afterAll(() => pool.close());

const noRows = () => Effect.succeed([]);

const { capability: prediction } = makePredictionFunctionAdapter({
  pool,
  filters: pageFiltersOn(pool.evaluations.filters),
  database: { read: noRows, write: noRows, transaction: noRows, readConsistently: (reads) => reads(noRows) },
  features: { includes: () => Effect.succeed(false), refusal: () => Effect.die('No feature is asked') },
  settings: new Map(),
  mostFunctions: 1,
  triesBeforeStall: 1,
});

const question = '{ series: north, horizon: 1, given: { promotion: 1 } }';

const predicting = [
  "document: { dsl: '1.0.3', namespace: acme, name: predicting, version: '1.0.0' }",
  'do:',
  `  - ask: { call: run_definition, with: { type: prediction, name: weekly-orders, input: ${question} } }`,
  "  - computed: { call: run_definition, with: { type: prediction, name: weekly-orders, input: '${ $data }' } }",
].join('\n');

describe('the calls of a workflow to a prediction function', () => {
  it('wait 10 s for a question, written out or computed at run time, since the forecaster answers within its call', async () => {
    const { starts, recording } = recordingStarts();
    const playbook = playbookOn(memoryLedger(), [recordingWorkflows(recording), prediction]);
    await playbook.call(playbook.createDefinition, { type: 'prediction', name: 'weekly-orders', source: weeklyOrders });
    await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'predicting', source: predicting });

    await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'predicting', run_id: runId });

    expect(starts.map(({ limits }) => limits.longestCallMsByTask)).toEqual([
      { '/do/0/ask': 10_000 + callMarginMs, '/do/1/computed': 10_000 + callMarginMs },
    ]);
  });
});

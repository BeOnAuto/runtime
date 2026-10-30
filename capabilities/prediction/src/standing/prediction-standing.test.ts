import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { datasetDetailsOf } from '../capability/prediction-definitions.ts';
import type { DatasetRow } from '../dataset/dataset-rows.ts';
import { parsePredictionDocument } from '../document/document-parsing.ts';
import { predictionRuns } from '../testing/prediction-runs.ts';
import { weeklyOrders } from '../testing/weekly-orders.ts';

const anyText: unknown = expect.any(String);

const asked = { org: 'acme', playbook: 'alpha', name: 'weekly-orders', version: 1 } as const;

const document = Result.getOrThrow(parsePredictionDocument(weeklyOrders));

const details = datasetDetailsOf(document);

const { dataSha256 } = document;

const live: DatasetRow = {
  playbookKey: 'playbook/acme/alpha/',
  dataSha256,
  saved: 3,
  phase: 'live',
  checkpoint: ['41', '0'],
  checkpointText: '["41","0"]',
  checkpointAt: '2026-10-06T10:00:00.000Z',
  rows: 3,
  series: 2,
  firstPeriod: '2026-W41',
  lastPeriod: '2026-W42',
  eventsFolded: 4,
  passedOver: 1,
  tries: 0,
  stall: null,
  data: {
    period: 'week',
    events: [],
    time: 'event',
    series: '',
    target: { as: 'count' },
  },
};

const rebuilding: DatasetRow = { ...live, phase: 'rebuilding', checkpoint: undefined, checkpointText: '' };

const stall = { record: 'a1b2c3d4-0000-7000-8000-000000000001', detail: 'Its data test was stopped 20 times' };

const stalled: DatasetRow = { ...live, phase: 'stalled', tries: 20, stall };

const waitingStanding = {
  dataset: {
    kind: 'projection',
    data_sha256: dataSha256,
    phase: 'waiting',
    checkpoint: null,
    checkpoint_at: null,
    rows: 0,
    series: 0,
    first_period: null,
    last_period: null,
    events_folded: 0,
    passed_over: 0,
    stall: null,
  },
};

const liveStanding = {
  dataset: {
    kind: 'projection',
    data_sha256: dataSha256,
    phase: 'live',
    checkpoint: anyText,
    checkpoint_at: '2026-10-06T10:00:00.000Z',
    rows: 3,
    series: 2,
    first_period: '2026-W41',
    last_period: '2026-W42',
    events_folded: 4,
    passed_over: 1,
    stall: null,
  },
};

describe('the standing of a prediction function whose data is a projection', () => {
  it('shows its dataset waiting until the projector makes it, then its phase, checkpoint and figures, and the event it stalled at', async () => {
    const { capability, datasets } = predictionRuns();
    const standing = () => Effect.runPromise(capability.standing({ ...asked, status: 'active', details }));
    const waiting = await standing();
    datasets.keep(dataSha256, live);
    const shown = await standing();
    datasets.keep(dataSha256, rebuilding);

    expect([waiting, shown]).toEqual([waitingStanding, liveStanding]);
    expect(await standing()).toMatchObject({ dataset: { phase: 'rebuilding', checkpoint: null } });
    datasets.keep(dataSha256, stalled);
    expect(await standing()).toMatchObject({ dataset: { phase: 'stalled', stall } });
  });
});

describe('the standing of a prediction function that is retired', () => {
  it('shows nothing for one retired or saved without the details of its dataset', async () => {
    const { capability } = predictionRuns();

    expect([
      await Effect.runPromise(capability.standing({ ...asked, status: 'retired', details })),
      await Effect.runPromise(capability.standing({ ...asked, status: 'active' })),
    ]).toEqual([undefined, undefined]);
  });
});

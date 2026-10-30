import { randomUUID } from 'node:crypto';

import type { Outcome } from '@on.auto/operations';
import { DatabaseFailed, type HostDatabase } from '@on.auto/workflow-host';
import { Effect, type Schema } from 'effect';
import { expect } from 'vitest';

import { isLive } from '../dataset-testing/dataset-predicates.ts';
import type { SettingsOf } from '../dataset-testing/dataset-stores.ts';
import { projectedDatasets } from '../dataset-testing/projected-datasets.ts';
import { questionPlaybook, type QuestionPlaybook } from './question-playbook.ts';
import { clockRunningFrom, startedAt, today } from './suite-clock.ts';

const day = 86_400_000;

type Reading = 'live' | 'empty' | 'failing';

export interface Projected {
  readonly playbook: QuestionPlaybook;
  readonly asked: (input: object) => Promise<Outcome>;
  readonly read: (reading: Reading) => void;
}

export interface Sales {
  readonly name: string;
  readonly source: string;
  readonly type: string;
  readonly base: Readonly<Record<string, number>>;
  readonly before: number;
  readonly valueOf: (level: number, day: number) => number | null | undefined;
  readonly events?: readonly Schema.JsonObject[];
}

function eventOf(type: string, store: string, at: number, value: number | null): Schema.JsonObject {
  return {
    specversion: '1.0',
    id: randomUUID(),
    source: '/stores',
    type,
    time: new Date(at + 3_600_000).toISOString(),
    data: value === null ? { store } : { store, value },
  };
}

function eventsBefore(sales: Sales): readonly Schema.JsonObject[] {
  const days = Array.from({ length: sales.before }, (_, at) => today - sales.before + at);
  return Object.keys(sales.base).flatMap((store) =>
    days.flatMap((each) => {
      const value = sales.valueOf(Number(sales.base[store]), each);
      return value === undefined ? [] : [eventOf(sales.type, store, each * day, value)];
    }),
  );
}

type Consistent = Pick<HostDatabase, 'readConsistently'>;

function databaseReading(database: Consistent, reading: () => Reading): Consistent {
  return {
    readConsistently: (reads) => {
      const current = reading();
      if (current === 'failing') {
        return Effect.fail(new DatabaseFailed({ detail: 'The database went away' }));
      }
      return current === 'empty' ? reads(() => Effect.succeed([])) : database.readConsistently(reads);
    },
  };
}

export async function projectedSales(settingsOf: SettingsOf, sales: Sales): Promise<Projected> {
  const datasets = await projectedDatasets(await settingsOf());
  const document = await datasets.saved(sales.name, sales.source);
  await datasets.published(sales.events ?? eventsBefore(sales));
  datasets.start();
  await datasets.until(document.dataSha256, isLive);
  const reading: { current: Reading } = { current: 'live' };
  const playbook = questionPlaybook({
    clock: clockRunningFrom(startedAt),
    database: databaseReading(datasets.database, () => reading.current),
    datasets: datasets.database,
  });
  expect(
    await playbook.call(playbook.operations.create, { type: 'prediction', name: sales.name, source: sales.source }),
  ).toMatchObject({ status: 'succeeded' });
  return {
    playbook,
    asked: (input) => playbook.call(playbook.operations.run, { type: 'prediction', name: sales.name, input }),
    read: (current) => {
      reading.current = current;
    },
  };
}

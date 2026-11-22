import { SQL } from '@event-driven-io/dumbo';
import { topicFacts, topicRows } from '@on.auto/operations/testing';
import { Effect, Schema, type Layer } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import type { LedgerServices } from '../ledger-layer.ts';
import type { KeptTables, ProjectionParts } from '../projections/projection-parts.ts';
import { openLedgerWith } from './open-ledger.ts';

export interface FillStore {
  readonly ledgerOn: (projections: KeptTables['projections']) => Layer.Layer<LedgerServices>;
  readonly executedOn: <A>(work: (execute: StatementExecutor) => Promise<A>) => Promise<A>;
  readonly projectionsOf: (kept: KeptTables) => Pick<ProjectionParts, 'prepare' | 'caughtUp'>;
}

export interface FillSizes {
  readonly facts: number;
  readonly factBytes: number;
  readonly mostBytesFilledAtOnce: number;
}

export interface FillMeasured {
  readonly history: number;
  readonly loads: readonly number[];
  readonly held: readonly number[];
  readonly kept: readonly unknown[];
  readonly filled: readonly unknown[];
}

const alpha = { org: 'acme', playbook: 'alpha' };

const everyRow = { where: [], orderBy: [], order: 'asc', limit: 1000 } as const;

const decodeData = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ data: Schema.optionalKey(Schema.Unknown) })));

function loadedBy(rows: readonly unknown[]): number {
  return decodeData(rows).reduce(
    (sum: number, { data }) => sum + (data === undefined ? 0 : JSON.stringify(data).length),
    0,
  );
}

async function rowsKept(store: FillStore): Promise<readonly unknown[]> {
  const { ledger, dispose } = await openLedgerWith(store.ledgerOn([topicRows]));
  try {
    const rows = await Effect.runPromise(ledger.readProjectedRows('topics', alpha, everyRow));
    return rows.map(({ key, row }) => ({ key, row: { ...row, note: String(row['note']).replace(/:.*$/su, '') } }));
  } finally {
    await dispose();
  }
}

async function noted(store: FillStore, { facts, factBytes }: FillSizes): Promise<void> {
  const { ledger, dispose } = await openLedgerWith(store.ledgerOn([topicRows]));
  try {
    await Effect.runPromise(
      Effect.andThen(
        ledger.execute('playbook/acme/alpha/runs/r1', topicFacts, [
          { type: 'topic_opened', data: { topic: 'autumn', at: 1000 } },
        ]),
        Effect.forEach(
          Array.from({ length: facts }, (_, index) => index),
          (index) =>
            ledger.execute(`playbook/acme/alpha/notes/n${index}`, topicFacts, [
              { type: 'topic_noted', data: { topic: 'autumn', note: `${index}:${'n'.repeat(factBytes)}` } },
            ]),
          { discard: true },
        ),
      ),
    );
  } finally {
    await dispose();
  }
}

export async function fillMeasuredOn(store: FillStore, sizes: FillSizes, heldNow: () => number): Promise<FillMeasured> {
  await noted(store, sizes);
  const kept = await rowsKept(store);
  const { held, loads } = await store.executedOn(async (execute) => {
    await execute.command(SQL`DROP TABLE topics_2`);
    const measured: { held: number[]; loads: number[] } = { held: [], loads: [] };
    const counting: StatementExecutor = {
      query: async (sql) => {
        measured.held.push(heldNow());
        const answer = await execute.query(sql);
        measured.loads.push(loadedBy(answer.rows));
        return answer;
      },
      command: (sql) => execute.command(sql),
    };
    const parts = store.projectionsOf({ projections: [topicRows], mostBytesFilledAtOnce: sizes.mostBytesFilledAtOnce });
    await parts.prepare(counting, (work) => work(counting));
    await parts.caughtUp((work) => work(counting));
    return measured;
  });
  return { history: sizes.facts * sizes.factBytes, loads, held, kept, filled: await rowsKept(store) };
}

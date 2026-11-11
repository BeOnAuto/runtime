import { SQL } from '@event-driven-io/dumbo';
import { topicFacts, topicRows } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';

import { filledStoreOf } from './filled-stores.ts';
import type { StatementExecutor } from './src/event-store.ts';
import { openLedgerWith } from './src/testing/open-ledger.ts';

const FilledIn = Schema.Union([
  Schema.Struct({ store: Schema.Literal('sqlite'), file: Schema.String }),
  Schema.Struct({ store: Schema.Literal('postgresql'), connectionString: Schema.String }),
]);

const [filledInText = '', factsText = '256', factBytesText = '65536', mostBytesText = '2097152'] =
  process.argv.slice(2);

const store = filledStoreOf(Schema.decodeUnknownSync(Schema.fromJsonString(FilledIn))(filledInText));

const facts = Number(factsText);

const factBytes = Number(factBytesText);

const mostBytesFilledAtOnce = Number(mostBytesText);

const alpha = { org: 'acme', playbook: 'alpha' };

const everyRow = { where: [], orderBy: [], order: 'asc', limit: 1000 } as const;

const decodeData = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ data: Schema.optionalKey(Schema.Unknown) })));

function loadedBy(rows: readonly unknown[]): number {
  return decodeData(rows).reduce(
    (sum: number, { data }) => sum + (data === undefined ? 0 : JSON.stringify(data).length),
    0,
  );
}

function heapUsed(): number {
  globalThis.gc?.();
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

function indexes(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}

async function rowsKept(): Promise<readonly unknown[]> {
  const { ledger, dispose } = await openLedgerWith(store.ledgerOn([topicRows]));
  try {
    const rows = await Effect.runPromise(ledger.readProjectedRows('topics', alpha, everyRow));
    return rows.map(({ key, row }) => ({ key, row: { ...row, note: String(row['note']).replace(/:.*$/su, '') } }));
  } finally {
    await dispose();
  }
}

async function noted(): Promise<void> {
  const { ledger, dispose } = await openLedgerWith(store.ledgerOn([topicRows]));
  try {
    await Effect.runPromise(
      Effect.andThen(
        ledger.execute('playbook/acme/alpha/runs/r1', topicFacts, [
          { type: 'topic_opened', data: { topic: 'autumn', at: 1000 } },
        ]),
        Effect.forEach(
          indexes(facts),
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

interface Measured {
  readonly held: readonly number[];
  readonly loads: readonly number[];
}

function filledMeasured(): Promise<Measured> {
  return store.executedOn(async (execute) => {
    await execute.command(SQL`DROP TABLE topics_2`);
    const held: number[] = [];
    const loads: number[] = [];
    const before = heapUsed();
    const measured: StatementExecutor = {
      query: async (sql) => {
        held.push(heapUsed() - before);
        const answer = await execute.query(sql);
        loads.push(loadedBy(answer.rows));
        return answer;
      },
      command: (sql) => execute.command(sql),
    };
    await store
      .projectionsOf({ projections: [topicRows], mostBytesFilledAtOnce })
      .prepare(measured, (work) => work(measured));
    return { held, loads };
  });
}

await noted();
const kept = await rowsKept();
const { held, loads } = await filledMeasured();
const filled = await rowsKept();
process.stdout.write(
  `${JSON.stringify({
    history: facts * factBytes,
    mostHeld: Math.max(...held),
    mostLoaded: Math.max(...loads),
    loaded: loads.reduce((sum, load) => sum + load, 0),
    kept,
    filled,
  })}\n`,
);

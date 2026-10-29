import { tick, timeOf } from '@on.auto/ledger/dataset';
import { ContextSchema, type Context, type Decided, type Decider } from '@on.auto/operations';
import { runFacts, type RunFact } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';

import { runOutcomeMapping } from '../src/analytics/run-outcome-mapping.ts';
import { firstDay, lastDay, runOf, type OutcomeRow } from './outcomes-dataset.ts';
import { onPostgreSQL, onSQLite, openLedgerWith, type Bench, type OpenLedger } from './outcomes-stores.ts';

const sizes = (process.env['LEDGER_MEASURE_OUTCOME_RUNS'] ?? '10000,100000').split(',').map(Number);

const fillTicks = Number(process.env['LEDGER_MEASURE_FILL_TICKS'] ?? 100_000);

const appends = 1000;

const recordBytes = 65_536;

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const parts = new Set((process.env['LEDGER_MEASURE_PARTS'] ?? 'read,append,fill,large-fill').split(','));

const largeRuns = 300;

const largeRecordBytes = 1_048_576;

const big = { org: 'o1', playbook: 'big' };

const RunEventSchema = Schema.Struct({
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Json),
  context: ContextSchema,
});

type RunEvent = Decided<typeof RunEventSchema.Type>;

interface RunAppend {
  readonly events: readonly RunEvent[];
  readonly context: Context;
}

const runEvents: Decider<null, RunAppend, typeof RunEventSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: ({ events }) => Result.succeed(events),
  context: ({ context }) => context,
  eventSchema: RunEventSchema,
};

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function timed<A>(attempt: () => Promise<A>): Promise<{ readonly took: number; readonly answer: A }> {
  const started = performance.now();
  const answer = await attempt();
  return { took: performance.now() - started, answer };
}

function shareOf(times: readonly number[], share: number): number {
  const sorted = times.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

function statsOf(times: readonly number[]): string {
  return `${shareOf(times, 0.5).toFixed(2)} (${Math.max(...times).toFixed(2)})`;
}

function appendStatsOf(times: readonly number[]): string {
  return `${shareOf(times, 0.5).toFixed(2)} (${shareOf(times, 0.95).toFixed(2)})`;
}

async function repeated(warm: number, times: number, attempt: () => Promise<unknown>): Promise<readonly number[]> {
  await Effect.runPromise(
    Effect.forEach(Array.from({ length: warm }), () => Effect.promise(attempt), { discard: true }),
  );
  return Effect.runPromise(
    Effect.forEach(Array.from({ length: times }), () => Effect.promise(async () => (await timed(attempt)).took)),
  );
}

function rowsOfRuns(index: number, runs: number): readonly OutcomeRow[] {
  return index < runs ? runOf('big', index, recordBytes) : runOf('small', index - runs, recordBytes);
}

function readingOf(ledger: OpenLedger['ledger'], from = firstDay, to = lastDay): () => Promise<number> {
  return async () => {
    const groups = await Effect.runPromise(ledger.readRunOutcomes(big, { from, to }, {}));
    return groups.reduce((total, { status, runs }) => (status === 'started' ? total : total + runs), 0);
  };
}

async function theRead(bench: Bench, runs: number): Promise<void> {
  const place = await bench.aPlace();
  await (await openLedgerWith(bench.ledgerOn(place))).dispose();
  await bench.write(place, runs + runs / 10, (index) => rowsOfRuns(index, runs));
  const opening = await timed(() => openLedgerWith(bench.ledgerOn(place)));
  await opening.answer.dispose();
  const filling = await timed(() => openLedgerWith(bench.ledgerOn(place, runOutcomeMapping)));
  const read = readingOf(filling.answer.ledger);
  const counted = await read();
  const reads = await repeated(3, 20, read);
  const aggregated = await bench.aggregate(place);
  const aggregates = await repeated(1, 3, () => bench.aggregate(place));
  await filling.answer.dispose();
  await place.drop();
  write(
    `| ${bench.store} | ${runs} | ${counted} | ${statsOf(reads)} | ${aggregated} | ${statsOf(aggregates)} | ${seconds(opening.took)} | ${seconds(filling.took)} |`,
  );
}

function aNote(run: number): RunFact {
  return { type: 'run_began', data: { at: timeOf(run), fn: `fn-${run % 20}` } };
}

function runEventsOf(run: number): readonly RunAppend[] {
  const context = {
    at: timeOf(run),
    by: 'u',
    runId: `a-${run}`,
    definitionType: 'reasoning',
    definitionName: `fn-${run % 20}`,
    definitionVersion: 1,
  };
  const record = { usage: { input: { total: 100 } }, prompt: 'p'.repeat(2048) };
  return [
    { events: [{ type: 'run_started', data: { input: {}, started_by: { id: 'u', name: 'u' } } }], context },
    { events: [{ type: 'run_succeeded', data: { output: 'ok', record } }], context },
  ];
}

async function appendTimes(bench: Bench, kept: boolean): Promise<readonly number[]> {
  const place = await bench.aPlace();
  const { ledger, dispose } = await openLedgerWith(bench.ledgerOn(place, kept ? runOutcomeMapping : undefined));
  await Effect.runPromise(ledger.execute('playbook/o1/big/notes', runFacts, [aNote(0)]));
  const times = await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: appends }, (_, run) => run),
      (run) =>
        Effect.forEach(runEventsOf(run), (append) =>
          Effect.promise(
            async () =>
              (await timed(() => Effect.runPromise(ledger.execute(`playbook/o1/big/runs/a-${run}`, runEvents, append))))
                .took,
          ),
        ),
    ),
  );
  await dispose();
  await place.drop();
  return times.flat();
}

async function theAppend(bench: Bench): Promise<void> {
  const without = await appendTimes(bench, false);
  const kept = await appendTimes(bench, true);
  write(`| ${bench.store} | ${appendStatsOf(without)} | ${appendStatsOf(kept)} |`);
}

function rowsOfTick(index: number): readonly OutcomeRow[] {
  const created = timeOf(index);
  return tick(index).map((row) => Object.assign({ created }, row));
}

async function theFill(bench: Bench): Promise<void> {
  const place = await bench.aPlace();
  await (await openLedgerWith(bench.ledgerOn(place))).dispose();
  await bench.write(place, fillTicks, rowsOfTick);
  const opening = await timed(() => openLedgerWith(bench.ledgerOn(place)));
  await opening.answer.dispose();
  const filling = await timed(() => openLedgerWith(bench.ledgerOn(place, runOutcomeMapping)));
  const runs = await readingOf(filling.answer.ledger, '2026-01-01', '2026-12-31')();
  await filling.answer.dispose();
  await place.drop();
  write(`| ${bench.store} | ${fillTicks} | ${runs} | ${seconds(opening.took)} | ${seconds(filling.took)} |`);
}

function mebibytesBetween(before: number | undefined, after: number | undefined): string {
  return before === undefined || after === undefined ? '' : `${Math.round((after - before) / 1_048_576)} MiB`;
}

async function theLargeFill(bench: Bench): Promise<void> {
  const place = await bench.aPlace();
  await (await openLedgerWith(bench.ledgerOn(place))).dispose();
  await bench.write(place, largeRuns, (index) => runOf('big', index, largeRecordBytes));
  const opening = await timed(() => openLedgerWith(bench.ledgerOn(place)));
  await opening.answer.dispose();
  const readBefore = await bench.recordBytesRead?.(place);
  const filling = await timed(() => openLedgerWith(bench.ledgerOn(place, runOutcomeMapping)));
  const runs = await readingOf(filling.answer.ledger)();
  await filling.answer.dispose();
  const read = mebibytesBetween(readBefore, await bench.recordBytesRead?.(place));
  await place.drop();
  write(`| ${bench.store} | ${largeRuns} | ${runs} | ${seconds(opening.took)} | ${seconds(filling.took)} | ${read} |`);
}

const benches: readonly Bench[] = postgresqlServer === '' ? [onSQLite] : [onSQLite, onPostgreSQL(postgresqlServer)];

async function inTurn(each: (bench: Bench) => Promise<void>): Promise<void> {
  await Effect.runPromise(Effect.forEach(benches, (bench) => Effect.promise(() => each(bench)), { discard: true }));
}

if (parts.has('read')) {
  write(
    '| Store | Runs in the window | Runs read | Read, median (slowest) ms | Runs aggregated | Aggregate over the records, median (slowest) ms | Open | Open and fill |',
  );
  write('| --- | --- | --- | --- | --- | --- | --- | --- |');
  await Effect.runPromise(
    Effect.forEach(sizes, (runs) => Effect.promise(() => inTurn((bench) => theRead(bench, runs))), { discard: true }),
  );
}
if (parts.has('append')) {
  write('\n| Store | Append without the projection, median (p95) ms | Append with it, median (p95) ms |');
  write('| --- | --- | --- |');
  await inTurn(theAppend);
}
if (parts.has('fill')) {
  write('\n| Store | Ticks of the dataset | Runs of its big playbook kept | Open | Open and fill |');
  write('| --- | --- | --- | --- | --- |');
  await inTurn(theFill);
}
if (parts.has('large-fill')) {
  write('\n| Store | Runs, most with a record of 1 MiB | Runs kept | Open | Open and fill | Record pages read |');
  write('| --- | --- | --- | --- | --- | --- |');
  await inTurn(theLargeFill);
}

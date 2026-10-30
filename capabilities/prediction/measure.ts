import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { pageFiltersOn } from '@on.auto/workflow-engine';
import { handedWorkersOf, programPool, sandboxShippedRoots } from '@on.auto/workflow-engine/dsl';

import { rebuiltOn, type Folding, type History } from './measure/dataset-rebuild.ts';
import { dailyOrders, seriesMeasured, testedDailyOrders } from './measure/order-history.ts';
import { measuredStores, type MeasuredStore } from './measure/stores.ts';

const sandboxFiles = shippedFilesOnDisk(sandboxShippedRoots());

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const days = 200;

const liveDays = 10;

const counted = new Intl.NumberFormat('en');

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function rateOf({ events, milliseconds }: Folding): string {
  return `${counted.format(Math.round((events * 1000) / milliseconds))} events a second`;
}

function pageCostOf({ pages, milliseconds }: Folding): string {
  return `${(milliseconds / pages).toFixed(1)} ms a page`;
}

async function untestedOn({ store, aDatabase }: MeasuredStore, history: History): Promise<void> {
  const { settings } = await aDatabase();
  const { folders, recordingMs, rebuild, live } = await rebuiltOn(settings, dailyOrders, history);
  write(
    `${store}: ${counted.format(rebuild.events)} events of ${seriesMeasured} series over ${days} days recorded in ${seconds(recordingMs)}`,
  );
  write(
    `${store}: the dataset rebuilt from that history in ${seconds(rebuild.milliseconds)}, ${rateOf(rebuild)}, in ${rebuild.pages} pages, ${pageCostOf(rebuild)}, to ${counted.format(rebuild.row.rows)} rows of ${rebuild.row.series} series`,
  );
  write(
    `${store}: ${counted.format(live.events)} more events appended in ${liveDays} appends folded live within ${seconds(live.milliseconds)} of the first, ${rateOf(live)}, to ${counted.format(live.row.rows)} rows`,
  );
  await folders.close();
}

async function testedOn({ store, aDatabase }: MeasuredStore, history: History): Promise<void> {
  const { settings } = await aDatabase();
  const { folders, rebuild, live } = await rebuiltOn(settings, testedDailyOrders, history);
  write(
    `${store}: with a data test on the pool's filter thread, the dataset rebuilt from the same history in ${seconds(rebuild.milliseconds)}, ${rateOf(rebuild)}, in ${rebuild.pages} pages, ${pageCostOf(rebuild)}, to ${counted.format(rebuild.row.rows)} rows`,
  );
  write(
    `${store}: with a data test, ${counted.format(live.events)} more events folded live within ${seconds(live.milliseconds)} of the first, ${rateOf(live)}`,
  );
  await folders.close();
}

async function measuredOn(measured: MeasuredStore): Promise<void> {
  const pool = programPool({
    handed: await handedWorkersOf(sandboxFiles),
    instances: 'fresh',
    workers: 1,
    heapMegabytes: 256,
  });
  const history = { days, liveDays, filters: pageFiltersOn(pool.evaluations.filters) };
  try {
    await untestedOn(measured, history);
    await testedOn(measured, history);
  } finally {
    await pool.close();
    await measured.removeAll();
  }
}

async function measuredInTurn(stores: readonly MeasuredStore[]): Promise<void> {
  const [first, ...rest] = stores;
  if (first !== undefined) {
    await measuredOn(first);
    await measuredInTurn(rest);
  }
}

write(`Node ${process.version}`);
await measuredInTurn(measuredStores(postgresqlServer));

import { setTimeout } from 'node:timers/promises';

import type { FilterSandbox } from '@on.auto/workflow-engine';
import { someFolder, type HostDatabase } from '@on.auto/workflow-host';
import { projectedFolders, type DatabaseSettings, type ProjectedFolders } from '@on.auto/workflow-host/testing';
import { Effect } from 'effect';

import { datasetFolder, datasetsOf } from '../src/dataset/dataset-folder.ts';
import type { DatasetRow } from '../src/dataset/dataset-rows.ts';
import { alphaKey, recordedDays, savedIn, seriesMeasured, type MeasuredFunction } from './order-history.ts';

export interface Folding {
  readonly events: number;
  readonly pages: number;
  readonly milliseconds: number;
  readonly row: DatasetRow;
}

export interface History {
  readonly days: number;
  readonly liveDays: number;
  readonly filters: FilterSandbox;
}

export interface Rebuilt {
  readonly folders: ProjectedFolders;
  readonly recordingMs: number;
  readonly rebuild: Folding;
  readonly live: Folding;
}

interface Counting {
  readonly through: (database: HostDatabase) => HostDatabase;
  readonly pages: () => number;
}

function counting(): Counting {
  const counted = { pages: 0 };
  return {
    through: (database) => ({
      ...database,
      store: {
        ...database.store,
        readRecorded: (playbookKey, selection, page) => {
          counted.pages += 1;
          return database.store.readRecorded(playbookKey, selection, page);
        },
      },
    }),
    pages: () => counted.pages,
  };
}

async function liveAt(folders: ProjectedFolders, dataSha256: string, events: number): Promise<DatasetRow> {
  const rows = await Effect.runPromise(datasetsOf(folders.database, alphaKey));
  const row = rows.find((dataset) => dataset.dataSha256 === dataSha256);
  if (row?.phase === 'live' && row.eventsFolded === events) {
    return row;
  }
  await setTimeout(20);
  return liveAt(folders, dataSha256, events);
}

async function timed(work: () => Promise<DatasetRow>, pages: () => number, events: number): Promise<Folding> {
  const pagesBefore = pages();
  const started = performance.now();
  const row = await work();
  return { events, pages: pages() - pagesBefore, milliseconds: performance.now() - started, row };
}

export async function rebuiltOn(
  settings: DatabaseSettings,
  measured: MeasuredFunction,
  { days, liveDays, filters }: History,
): Promise<Rebuilt> {
  const folder = datasetFolder({ filters, triesBeforeStall: Number.POSITIVE_INFINITY });
  const folders = await projectedFolders(settings, [someFolder(folder)]);
  const { dataSha256 } = measured.document;
  const recordingStarted = performance.now();
  await recordedDays(folders, 0, days);
  const recordingMs = performance.now() - recordingStarted;
  await savedIn(folders, measured);
  const count = counting();
  const history = days * seriesMeasured;
  const started = timed(() => liveAt(folders, dataSha256, history), count.pages, history);
  folders.start({ sweepEveryMs: 50, pagesPerWake: 10, playbooksAtOnce: 4, through: count.through });
  const rebuild = await started;
  const after = history + liveDays * seriesMeasured;
  const live = timed(() => liveAt(folders, dataSha256, after), count.pages, liveDays * seriesMeasured);
  await recordedDays(folders, days, liveDays);
  return { folders, recordingMs, rebuild, live: await live };
}

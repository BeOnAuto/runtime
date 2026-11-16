import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ledgerLayout } from '../layout/ledger-layout.ts';
import { fileReadOf, writerOf } from './file-read.ts';
import { readAsALedger } from './ledger-reads.ts';
import { filesKeptOf, onACopy, pinnedEndings, type PinnedEnding, type PinnedRecord } from './pinned-record.ts';
import { pinnedFileWritten } from './pinned-writing.ts';

async function recordOfTheFile(folder: Readonly<URL>, ending: PinnedEnding): Promise<PinnedRecord> {
  const { layout, sqlite } = await onACopy(folder, ending, writerOf);
  return {
    layout,
    writtenOn: new Date().toISOString().slice(0, 10),
    writtenBy: { node: process.version, sqlite },
    files: filesKeptOf(folder, ending),
    file: await onACopy(folder, ending, fileReadOf),
    ledger: await onACopy(folder, ending, readAsALedger),
  };
}

async function recordedBeside(folder: Readonly<URL>, ending: PinnedEnding): Promise<void> {
  const record = await recordOfTheFile(folder, ending);
  writeFileSync(new URL(`${ending}.json`, folder), `${JSON.stringify(record, null, 2)}\n`);
}

export async function recordedInto(folder: Readonly<URL>, layout: number): Promise<void> {
  const directory = fileURLToPath(folder);
  if (layout !== ledgerLayout) {
    throw new Error(`This release keeps layout ${ledgerLayout}, so it records no ledger file of layout ${layout}`);
  }
  if (existsSync(directory)) {
    throw new Error(`${directory} holds the pinned ledger files already, which are recorded once and never again`);
  }
  mkdirSync(directory, { recursive: true });
  await pinnedFileWritten(directory, 'closed');
  await pinnedFileWritten(directory, 'ended-without-closing');
  await Promise.all(pinnedEndings.map((ending) => recordedBeside(folder, ending)));
}

export async function recordedWhereMissing(folder: Readonly<URL>, layout: number, recording: boolean): Promise<void> {
  if (recording && !existsSync(fileURLToPath(folder))) {
    await recordedInto(folder, layout);
  }
}

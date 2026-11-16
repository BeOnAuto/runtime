import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { onTestFinished } from 'vitest';

import { aTemporaryFolder, copiedFrom, databaseFileOf, filesKeptOf, type PinnedEnding } from './pinned-record.ts';

function kept(folder: Readonly<URL>, ending: PinnedEnding, files: readonly string[]): string {
  const copy = copiedFrom(folder, ending, files);
  onTestFinished(copy.remove);
  return copy.fileName;
}

export function aCopyOf(folder: Readonly<URL>, ending: PinnedEnding): string {
  return kept(folder, ending, Object.keys(filesKeptOf(folder, ending)));
}

export function aCopyOfTheDatabaseFileAlone(folder: Readonly<URL>, ending: PinnedEnding): string {
  return kept(folder, ending, [databaseFileOf(ending)]);
}

export function aFolderToRecordInto(made = false): URL {
  const directory = aTemporaryFolder();
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const folder = join(directory, 'recorded');
  if (made) {
    mkdirSync(folder);
  }
  return pathToFileURL(`${folder}/`);
}

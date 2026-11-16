import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Schema } from 'effect';

import { FileReadSchema } from './file-read.ts';

const PinnedRecordSchema = Schema.Struct({
  layout: Schema.Number,
  writtenOn: Schema.String,
  writtenBy: Schema.Struct({ node: Schema.String, sqlite: Schema.String }),
  files: Schema.Record(Schema.String, Schema.String),
  file: FileReadSchema,
  ledger: Schema.Json,
});

export type PinnedRecord = typeof PinnedRecordSchema.Type;

export type PinnedEnding = 'closed' | 'ended-without-closing';

export const pinnedEndings: readonly PinnedEnding[] = ['closed', 'ended-without-closing'];

const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(PinnedRecordSchema));

export function recordOf(folder: Readonly<URL>, ending: PinnedEnding): PinnedRecord {
  return decodeRecord(readFileSync(new URL(`${ending}.json`, folder), 'utf8'));
}

export function databaseFileOf(ending: PinnedEnding): string {
  return `${ending}.db`;
}

export function filesKeptOf(folder: Readonly<URL>, ending: PinnedEnding): Readonly<Record<string, string>> {
  const database = databaseFileOf(ending);
  return Object.fromEntries(
    readdirSync(folder)
      .filter((file) => file === database || file === `${database}-wal`)
      .toSorted()
      .map((file) => [
        file,
        createHash('sha256')
          .update(readFileSync(new URL(file, folder)))
          .digest('hex'),
      ]),
  );
}

interface CopiedFile {
  readonly fileName: string;
  readonly remove: () => void;
}

export function aTemporaryFolder(): string {
  return mkdtempSync(join(tmpdir(), 'auto-runtime-pinned-'));
}

export function copiedFrom(folder: Readonly<URL>, ending: PinnedEnding, files: readonly string[]): CopiedFile {
  const directory = aTemporaryFolder();
  files.forEach((file) => {
    copyFileSync(new URL(file, folder), join(directory, file));
  });
  return {
    fileName: join(directory, databaseFileOf(ending)),
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export async function onACopy<A>(
  folder: Readonly<URL>,
  ending: PinnedEnding,
  read: (fileName: string) => Promise<A>,
): Promise<A> {
  const copy = copiedFrom(folder, ending, Object.keys(filesKeptOf(folder, ending)));
  try {
    return await read(copy.fileName);
  } finally {
    copy.remove();
  }
}

import { copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { memoryContentStore } from '@on.auto/content/testing';

import { onTheLedgerOf, type OpenedLedgerFile } from './opened-ledger-file.ts';
import { factsAppended, factScrubbed } from './pinned-facts.ts';
import { aTemporaryFolder, databaseFileOf, type PinnedEnding } from './pinned-record.ts';
import { pinnedTables } from './pinned-tables.ts';
import { checkpointed, contentKept, contentKeptOutside, keptBeside, rowsOfTheirOwn } from './rows-written.ts';

interface Ending {
  readonly afterTheFacts: (open: OpenedLedgerFile) => Promise<void>;
  readonly keptWhileOpen: boolean;
}

const endingsOf: Readonly<Record<PinnedEnding, Ending>> = {
  closed: { afterTheFacts: checkpointed, keptWhileOpen: false },
  'ended-without-closing': { afterTheFacts: () => Promise.resolve(), keptWhileOpen: true },
};

const written = 'ledger.db';

function keptAs(directory: string, folder: string, ending: PinnedEnding): void {
  readdirSync(directory)
    .filter((file) => file === written || file === `${written}-wal`)
    .forEach((file) => {
      copyFileSync(join(directory, file), join(folder, `${databaseFileOf(ending)}${file.slice(written.length)}`));
    });
}

async function everyKindWritten(open: OpenedLedgerFile, { afterTheFacts }: Ending): Promise<void> {
  await factsAppended(open);
  await contentKept(open);
  await afterTheFacts(open);
  await factScrubbed(open);
  await keptBeside(open);
  await rowsOfTheirOwn(open);
}

export async function pinnedFileWritten(folder: string, ending: PinnedEnding): Promise<void> {
  const writing = endingsOf[ending];
  const directory = aTemporaryFolder();
  const fileName = join(directory, written);
  try {
    await onTheLedgerOf(fileName, contentKeptOutside, { ...pinnedTables, content: memoryContentStore() });
    await onTheLedgerOf(fileName, async (open) => {
      await everyKindWritten(open, writing);
      if (writing.keptWhileOpen) {
        keptAs(directory, folder, ending);
      }
    });
    if (!writing.keptWhileOpen) {
      keptAs(directory, folder, ending);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

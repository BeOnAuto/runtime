import { structureOfTheSQLiteFile } from '@on.auto/ledger/database-structure';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { onTestFinished } from 'vitest';

import { chatRowsInMemory } from '../../testing/chat/chat-rows-in-memory.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { chatDatabaseBehaviour, rowsOnTheLedger } from './chat-database-behaviour.ts';
import { chatLinksBehaviour } from './chat-links-behaviour.ts';
import { chatRowsBehaviour, type ChatRowsEntry } from './chat-rows-behaviour.ts';

function aLedgerFile(): string {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  return fileName;
}

const inMemory: ChatRowsEntry = { name: 'in memory', rowsOf: () => Promise.resolve(chatRowsInMemory()) };

const onASQLiteFile: ChatRowsEntry = {
  name: 'on a SQLite file',
  rowsOf: () => rowsOnTheLedger(ledgerLayer({ fileName: aLedgerFile() })),
};

for (const entry of [inMemory, onASQLiteFile]) {
  chatRowsBehaviour(entry);
  chatLinksBehaviour(entry);
}

chatDatabaseBehaviour({
  name: 'on a SQLite file',
  aDatabase: () => {
    const fileName = aLedgerFile();
    return Promise.resolve({
      ledgerOn: () => ledgerLayer({ fileName }),
      structure: () => structureOfTheSQLiteFile(fileName),
    });
  },
});

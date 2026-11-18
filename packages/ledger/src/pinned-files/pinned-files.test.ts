import { describe, expect, it } from 'vitest';

import { recordingAsked, recordingVariable } from '../recorded-facts/recorded-facts-behaviour.ts';
import { fileReadOf, rowCountsOf } from './file-read.ts';
import { aCopyOf, aCopyOfTheDatabaseFileAlone } from './pinned-copies.ts';
import { databaseFileOf, filesKeptOf, pinnedEndings, recordOf, type PinnedEnding } from './pinned-record.ts';
import { recordedWhereMissing } from './pinned-recording.ts';

const writtenAtLayout25 = new URL('layout-25/', import.meta.url);

await recordedWhereMissing(writtenAtLayout25, 25, recordingAsked());

const endings: Readonly<Record<PinnedEnding, string>> = {
  closed: 'the file of a ledger that closed',
  'ended-without-closing': 'the file of a ledger whose process ended without closing it',
};

function readByTheDriverAlone(ending: PinnedEnding): void {
  it(`is ${endings[ending]}, at layout 25, file for file the bytes recorded`, () => {
    const record = recordOf(writtenAtLayout25, ending);

    expect({ layout: record.layout, files: filesKeptOf(writtenAtLayout25, ending) }).toEqual({
      layout: 25,
      files: record.files,
    });
  });

  it('reads through the driver of the ledger alone, with no layout check, as the add-on read it: its integrity, its header and every row of every table', async () => {
    const record = recordOf(writtenAtLayout25, ending);

    const read = await fileReadOf(aCopyOf(writtenAtLayout25, ending));

    expect(read).toEqual(record.file);
    expect(read.integrity).toEqual(['ok']);
  });
}

describe(`the ledger files the sqlite3 add-on wrote at layout 25, which the tests record with ${recordingVariable}=1 where they are missing and never again`, () => {
  describe.each(pinnedEndings)('%s', (ending) => {
    readByTheDriverAlone(ending);
  });

  it('keeps, in the database file of the file whose ledger closed, the 15 facts appended before its checkpoint, and the 16th in its write-ahead log', async () => {
    const ending = 'closed';

    const alone = await fileReadOf(aCopyOfTheDatabaseFileAlone(writtenAtLayout25, ending));

    expect([rowCountsOf(alone), rowCountsOf(recordOf(writtenAtLayout25, ending).file)]).toMatchObject([
      { emt_messages: 15 },
      { emt_messages: 16 },
    ]);
  });

  it('keeps all 16 facts of the file whose process ended without closing its ledger in its write-ahead log, none in its database file', async () => {
    const ending = 'ended-without-closing';
    const record = recordOf(writtenAtLayout25, ending);

    const alone = await fileReadOf(aCopyOfTheDatabaseFileAlone(writtenAtLayout25, ending));

    expect(Object.keys(record.files)).toEqual([databaseFileOf(ending), `${databaseFileOf(ending)}-wal`]);
    expect([rowCountsOf(alone), rowCountsOf(record.file)]).toMatchObject([{ emt_messages: 0 }, { emt_messages: 16 }]);
  });
});

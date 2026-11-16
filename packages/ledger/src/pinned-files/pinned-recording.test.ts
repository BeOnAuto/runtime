import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ledgerLayout } from '../layout/ledger-layout.ts';
import { fileReadOf } from './file-read.ts';
import { readAsALedger } from './ledger-reads.ts';
import { aCopyOf, aFolderToRecordInto } from './pinned-copies.ts';
import { pinnedEndings, recordOf } from './pinned-record.ts';
import { recordedInto, recordedWhereMissing } from './pinned-recording.ts';

describe('the recording of pinned ledger files', () => {
  it("writes each file through the ledger's entry into a folder of its own, beside what it read of it, so that a copy reads back as recorded", async () => {
    const folder = aFolderToRecordInto();

    await recordedWhereMissing(folder, ledgerLayout, true);

    const read = await Promise.all(
      pinnedEndings.map(async (ending) => {
        const fileName = aCopyOf(folder, ending);
        return {
          layout: recordOf(folder, ending).layout,
          file: await fileReadOf(fileName),
          ledger: await readAsALedger(fileName),
        };
      }),
    );
    expect(read).toEqual(
      pinnedEndings.map((ending) => ({
        layout: ledgerLayout,
        file: recordOf(folder, ending).file,
        ledger: recordOf(folder, ending).ledger,
      })),
    );
  });

  it('records nothing in a run that does not ask for it, nor into a folder that holds files already', async () => {
    const [unasked, held] = [aFolderToRecordInto(), aFolderToRecordInto(true)];

    await recordedWhereMissing(unasked, ledgerLayout, false);
    await recordedWhereMissing(held, ledgerLayout, true);

    expect([existsSync(fileURLToPath(unasked)), existsSync(new URL('closed.json', held))]).toEqual([false, false]);
  });

  it('refuses a layout this release does not keep, and a folder that holds pinned files already', async () => {
    const [folder, held] = [aFolderToRecordInto(), aFolderToRecordInto(true)];

    await expect(recordedInto(folder, ledgerLayout + 1)).rejects.toThrow(
      `This release keeps layout ${ledgerLayout}, so it records no ledger file of layout ${ledgerLayout + 1}`,
    );
    await expect(recordedInto(held, ledgerLayout)).rejects.toThrow(
      'holds the pinned ledger files already, which are recorded once and never again',
    );
  });
});

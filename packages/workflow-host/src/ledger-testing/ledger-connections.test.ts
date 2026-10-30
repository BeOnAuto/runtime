import { fstatSync, readdirSync, statSync } from 'node:fs';

import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { tallyFolderOf } from '../folder-testing/tally-folder.ts';
import { someFolder } from '../projector/folder.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { recordedOptionsOf } from '../testing/host-runs.ts';
import { hostDatabaseOpenedOn, workflowHostOnALedger } from './ledger-connections.ts';

const unmadeTable = statement`CREATE TABLE`;

function opensTheFile(descriptor: number, device: number, inode: number): boolean {
  try {
    const opened = fstatSync(descriptor);
    return opened.dev === device && opened.ino === inode;
  } catch {
    return false;
  }
}

function descriptorsOpenOn(file: string): number {
  const { dev, ino } = statSync(file);
  return readdirSync('/dev/fd').filter((descriptor) => opensTheFile(Number(descriptor), dev, ino)).length;
}

describe('a host database opened on a ledger of its own', () => {
  it('closes the ledger it opened when the tables asked of it cannot be made', async () => {
    const file = aSQLiteFile();

    await expect(hostDatabaseOpenedOn({ store: 'sqlite', file }, [unmadeTable])).rejects.toThrow('SQLITE_ERROR');
    expect(descriptorsOpenOn(file)).toBe(0);
  });
});

describe('a host opened on a ledger of its own', () => {
  it('closes the ledger it opened once the host stops', async () => {
    const file = aSQLiteFile();
    const host = await workflowHostOnALedger({ store: 'sqlite', file }, recordedOptionsOf().options);
    const whileServing = descriptorsOpenOn(file);

    await host.stop();

    expect({ whileServing: whileServing > 0, afterStopping: descriptorsOpenOn(file) }).toEqual({
      whileServing: true,
      afterStopping: 0,
    });
  });

  it('closes the ledger it opened when the host cannot open', async () => {
    const file = aSQLiteFile();
    const unmade = someFolder({ ...tallyFolderOf(1), tables: [unmadeTable] });
    const options = {
      ...recordedOptionsOf().options,
      projector: { folders: [unmade], playbooksAtOnce: 1, pagesPerWake: 1 },
    };

    await expect(workflowHostOnALedger({ store: 'sqlite', file }, options)).rejects.toThrow('SQLITE_ERROR');
    expect(descriptorsOpenOn(file)).toBe(0);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { shippedFilesInMemory } from './shipped-files-in-memory.ts';
import { shippedFilesOnDisk } from './shipped-files-on-disk.ts';
import { shippedFileIn, shippedFileName, type ShippedFile, type ShippedFiles } from './shipped-files.ts';

const notes = 'Notes, in UTF-8: café\n';

const mark = Uint8Array.of(0, 255, 1);

const inner = 'Inner notes\n';

const shipper = '@acme/shipper';

const onDisk = mkdtempSync(join(tmpdir(), 'auto-runtime-shipped-files-'));
mkdirSync(join(onDisk, 'files', 'nested'), { recursive: true });
writeFileSync(join(onDisk, 'files', 'notes.txt'), notes);
writeFileSync(join(onDisk, 'files', 'mark.bin'), mark);
writeFileSync(join(onDisk, 'files', 'nested', 'inner.txt'), inner);

afterAll(() => {
  rmSync(onDisk, { recursive: true, force: true });
});

const folder: ShippedFile = { package: shipper, path: 'files' };

const readers: readonly (readonly [string, ShippedFiles])[] = [
  ['on disk', shippedFilesOnDisk({ [shipper]: pathToFileURL(`${onDisk}/`) })],
  [
    'in memory',
    shippedFilesInMemory({
      [shipper]: { 'files/notes.txt': notes, 'files/mark.bin': mark, 'files/nested/inner.txt': inner },
    }),
  ],
];

describe('a file shipped beside the code of a package', () => {
  it('is named by its package and its path within it, and a file of a folder by the path of the folder', () => {
    expect(shippedFileIn(folder, 'notes.txt')).toEqual({ package: shipper, path: 'files/notes.txt' });
    expect(shippedFileName(shippedFileIn(folder, 'notes.txt'))).toBe('@acme/shipper/files/notes.txt');
  });
});

describe.each(readers)('the files shipped %s', (_, reader) => {
  it('are read as text in UTF-8 and as bytes', async () => {
    const notesFile = shippedFileIn(folder, 'notes.txt');
    const markFile = shippedFileIn(folder, 'mark.bin');

    expect(await reader.text(notesFile)).toBe(notes);
    expect([...(await reader.bytes(notesFile))]).toEqual([...new TextEncoder().encode(notes)]);
    expect([...(await reader.bytes(markFile))]).toEqual([0, 255, 1]);
    expect(await reader.text(markFile)).toBe('\u0000�\u0001');
  });

  it('are listed by the names of the files directly in a folder, sorted', async () => {
    expect(await reader.list(folder)).toEqual(['mark.bin', 'notes.txt']);
    expect(await reader.list(shippedFileIn(folder, 'nested'))).toEqual(['inner.txt']);
  });

  it('refuse a file or a folder that is not shipped, and the files of a package it holds none of', async () => {
    const elsewhere = { package: '@acme/elsewhere', path: 'files/notes.txt' };

    await expect(reader.text(shippedFileIn(folder, 'missing.txt'))).rejects.toThrow('missing.txt');
    await expect(reader.bytes(shippedFileIn(folder, 'missing.txt'))).rejects.toThrow('missing.txt');
    await expect(reader.list(shippedFileIn(folder, 'missing'))).rejects.toThrow('missing');
    await expect(reader.text(elsewhere)).rejects.toThrow('@acme/elsewhere');
    await expect(reader.list(elsewhere)).rejects.toThrow('@acme/elsewhere');
  });
});

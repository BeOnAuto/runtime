import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { shippedFilesInMemory } from './shipped-files-in-memory.ts';
import { shippedFilesOnDisk } from './shipped-files-on-disk.ts';
import type { ShippedFiles } from './shipped-files.ts';

const notes = 'Notes, in UTF-8: café\n';

const mark = Uint8Array.of(0, 255, 1);

const inner = 'Inner notes\n';

const onDisk = mkdtempSync(join(tmpdir(), 'auto-runtime-shipped-files-'));
mkdirSync(join(onDisk, 'nested'));
writeFileSync(join(onDisk, 'notes.txt'), notes);
writeFileSync(join(onDisk, 'mark.bin'), mark);
writeFileSync(join(onDisk, 'nested', 'inner.txt'), inner);

afterAll(() => {
  rmSync(onDisk, { recursive: true, force: true });
});

const inMemory = new URL('file:///shipped/');

const readers: readonly (readonly [string, ShippedFiles, Readonly<URL>])[] = [
  ['on disk', shippedFilesOnDisk, pathToFileURL(`${onDisk}/`)],
  [
    'in memory',
    shippedFilesInMemory({
      [new URL('notes.txt', inMemory).href]: notes,
      [new URL('mark.bin', inMemory).href]: mark,
      [new URL('nested/inner.txt', inMemory).href]: inner,
    }),
    inMemory,
  ],
];

describe.each(readers)('the files shipped %s', (_, reader, folder) => {
  it('are read as text in UTF-8 and as bytes', async () => {
    expect(await reader.text(new URL('notes.txt', folder))).toBe(notes);
    expect([...(await reader.bytes(new URL('notes.txt', folder)))]).toEqual([...new TextEncoder().encode(notes)]);
    expect([...(await reader.bytes(new URL('mark.bin', folder)))]).toEqual([0, 255, 1]);
    expect(await reader.text(new URL('mark.bin', folder))).toBe('\u0000�\u0001');
  });

  it('are listed by the names of the files directly in a folder, sorted', async () => {
    expect(await reader.list(folder)).toEqual(['mark.bin', 'notes.txt']);
    expect(await reader.list(new URL('nested/', folder))).toEqual(['inner.txt']);
  });

  it('refuse a file or a folder that is not shipped', async () => {
    await expect(reader.text(new URL('missing.txt', folder))).rejects.toThrow('missing.txt');
    await expect(reader.bytes(new URL('missing.txt', folder))).rejects.toThrow('missing.txt');
    await expect(reader.list(new URL('missing/', folder))).rejects.toThrow('missing');
  });
});

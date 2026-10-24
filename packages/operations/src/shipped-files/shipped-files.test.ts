import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { shippedFilesInMemory } from './shipped-files-in-memory.ts';
import { shippedFilesOnDisk } from './shipped-files-on-disk.ts';
import {
  dependencyFileOf,
  shippedFileIn,
  shippedFileName,
  type ShippedFile,
  type ShippedFiles,
} from './shipped-files.ts';

const notes = 'Notes, in UTF-8: café\n';

const mark = Uint8Array.of(0, 255, 1);

const inner = 'Inner notes\n';

const shipper = '@acme/shipper';

const library = '@acme/library';

const libraryNotes = 'Notes of the library\n';

const onDisk = mkdtempSync(join(tmpdir(), 'auto-runtime-shipped-files-'));
mkdirSync(join(onDisk, 'files', 'nested'), { recursive: true });
writeFileSync(join(onDisk, 'files', 'notes.txt'), notes);
writeFileSync(join(onDisk, 'files', 'mark.bin'), mark);
writeFileSync(join(onDisk, 'files', 'nested', 'inner.txt'), inner);

function installed(
  folder: string,
  name: string,
  files: Readonly<Record<string, string>>,
  manifest?: Readonly<Record<string, unknown>>,
): void {
  const root = join(folder, 'node_modules', name);
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest ?? { name }));
  for (const [path, text] of Object.entries(files)) {
    writeFileSync(join(root, path), text);
  }
}

installed(onDisk, library, { 'dist/notes.txt': libraryNotes });

afterAll(() => {
  rmSync(onDisk, { recursive: true, force: true });
});

const folder: ShippedFile = { package: shipper, path: 'files' };

const readers: readonly (readonly [string, ShippedFiles])[] = [
  ['on disk', shippedFilesOnDisk({ [shipper]: pathToFileURL(`${onDisk}/`) })],
  [
    'in memory',
    shippedFilesInMemory({
      [shipper]: {
        'files/notes.txt': notes,
        'files/mark.bin': mark,
        'files/nested/inner.txt': inner,
        'node_modules/@acme/library/dist/notes.txt': libraryNotes,
      },
    }),
  ],
];

describe('a file shipped beside the code of a package', () => {
  it('is named by its package and its path within it, and a file of a folder by the path of the folder', () => {
    expect(shippedFileIn(folder, 'notes.txt')).toEqual({ package: shipper, path: 'files/notes.txt' });
    expect(shippedFileName(shippedFileIn(folder, 'notes.txt'))).toBe('@acme/shipper/files/notes.txt');
  });

  it('is named, when a dependency ships it, under the package that depends on it, in the folder of the dependency', () => {
    expect(dependencyFileOf(shipper, library, 'dist/notes.txt')).toEqual({
      package: shipper,
      path: 'node_modules/@acme/library/dist/notes.txt',
    });
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

  it('read a file a dependency ships, and list the folder it is in', async () => {
    const libraryFile = dependencyFileOf(shipper, library, 'dist/notes.txt');

    expect(await reader.text(libraryFile)).toBe(libraryNotes);
    expect(await reader.list(dependencyFileOf(shipper, library, 'dist'))).toEqual(['notes.txt']);
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

describe('the files of a dependency on disk', () => {
  const dependent = join(onDisk, 'packages', 'dependent');
  mkdirSync(dependent, { recursive: true });
  installed(onDisk, 'plain-library', { 'dist/notes.txt': 'Notes of a folder above\n' });
  installed(dependent, 'plain-library', { 'dist/notes.txt': 'Notes of its own folder\n' });
  installed(
    dependent,
    'hidden-library',
    { 'dist/index.js': 'export {};\n', 'dist/notes.txt': 'Notes behind its exports\n' },
    { name: 'hidden-library', exports: { '.': { import: './dist/index.js' } } },
  );
  const reader = shippedFilesOnDisk({ [shipper]: pathToFileURL(`${dependent}/`) });

  it('are found as Node finds the dependency from the root of the package that depends on it: in its own node_modules first, then in that of each folder above it', async () => {
    expect(await reader.text(dependencyFileOf(shipper, 'plain-library', 'dist/notes.txt'))).toBe(
      'Notes of its own folder\n',
    );
    expect(await reader.text(dependencyFileOf(shipper, library, 'dist/notes.txt'))).toBe(libraryNotes);
    expect(await reader.list(dependencyFileOf(shipper, library, ''))).toEqual(['package.json']);
  });

  it('are found when the exports of the dependency hide its package.json and give no entry to require', async () => {
    expect(await reader.text(dependencyFileOf(shipper, 'hidden-library', 'dist/notes.txt'))).toBe(
      'Notes behind its exports\n',
    );
  });

  it('are refused, naming the dependency, when no folder holds it', async () => {
    await expect(reader.text(dependencyFileOf(shipper, '@acme/missing', 'dist/notes.txt'))).rejects.toThrow(
      '@acme/missing',
    );
  });
});

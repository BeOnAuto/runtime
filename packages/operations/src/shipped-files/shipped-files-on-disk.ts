import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';

import { shippedFileName, type ShippedFile, type ShippedFiles, type ShippedRoots } from './shipped-files.ts';

function placeOf(roots: ShippedRoots, file: ShippedFile): Promise<URL> {
  const root = roots[file.package];
  return root === undefined
    ? Promise.reject(
        new Error(`No root is given for the files of ${file.package}, so ${shippedFileName(file)} is not read`),
      )
    : Promise.resolve(new URL(file.path, root));
}

async function namesIn(folder: Readonly<URL>): Promise<readonly string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry: Readonly<Dirent>) => entry.isFile())
    .map(({ name }: Readonly<Dirent>) => name)
    .toSorted();
}

export function shippedFilesOnDisk(roots: ShippedRoots): ShippedFiles {
  return {
    text: async (file) => readFile(await placeOf(roots, file), 'utf8'),
    bytes: async (file) => readFile(await placeOf(roots, file)),
    list: async (folder) => namesIn(await placeOf(roots, folder)),
  };
}

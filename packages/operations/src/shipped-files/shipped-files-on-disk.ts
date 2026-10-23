import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';

import type { ShippedFiles } from './shipped-files.ts';

export const shippedFilesOnDisk: ShippedFiles = {
  text: (file) => readFile(file, 'utf8'),
  bytes: (file) => readFile(file),
  list: async (folder) => {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries
      .filter((entry: Readonly<Dirent>) => entry.isFile())
      .map(({ name }: Readonly<Dirent>) => name)
      .toSorted();
  },
};

import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { pathToFileURL } from 'node:url';

import { Schema } from 'effect';

import {
  dependencyFileIn,
  shippedFileName,
  type ShippedFile,
  type ShippedFiles,
  type ShippedRoots,
} from './shipped-files.ts';

function placeUnder(root: Readonly<URL>, file: ShippedFile): URL {
  const ofDependency = dependencyFileIn(file);
  if (ofDependency === undefined) {
    return new URL(file.path, root);
  }
  const manifest = findPackageJSON(ofDependency.dependency, new URL('package.json', root));
  return new URL(`./${ofDependency.path}`, pathToFileURL(Schema.decodeUnknownSync(Schema.String)(manifest)));
}

function placeOf(roots: ShippedRoots, file: ShippedFile): Promise<URL> {
  const root = roots[file.package];
  return root === undefined
    ? Promise.reject(
        new Error(`No root is given for the files of ${file.package}, so ${shippedFileName(file)} is not read`),
      )
    : Promise.try(() => placeUnder(root, file));
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

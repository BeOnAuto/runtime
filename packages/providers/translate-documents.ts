import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';

import { providersShippedRoots } from './src/reading/shipped-providers.ts';
import { documentsBesideTheEntries, translatedDocuments } from './src/translating/document-manifests.ts';

const repository = fileURLToPath(new URL('../../', import.meta.url));

const formatter = fileURLToPath(new URL('../../node_modules/.bin/oxfmt', import.meta.url));

const written = await translatedDocuments(process.argv.slice(2), {
  folder: documentsBesideTheEntries,
  shippedFiles: shippedFilesOnDisk(providersShippedRoots()),
  fetching: fetch,
  readGiven: (path) => readFile(path, 'utf8'),
});
const onDisk: readonly { readonly path: string; readonly text: string }[] = written.map(({ file, text }) => ({
  path: fileURLToPath(new URL(file.path, import.meta.url)),
  text,
}));
const paths = onDisk.map(({ path }) => path);
for (const { path, text } of onDisk) {
  writeFileSync(path, text);
}
execFileSync(formatter, paths, { cwd: repository, stdio: 'inherit' });
for (const path of paths) {
  process.stdout.write(`Wrote ${path}\n`);
}

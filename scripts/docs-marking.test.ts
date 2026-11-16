import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';

import { markingFaultsOf } from '@on.auto/api';

const docs = resolve(import.meta.dirname, '../docs');

const pages = readdirSync(docs, { recursive: true, withFileTypes: true })
  .filter(
    (entry: Readonly<Dirent>) =>
      entry.isFile() && entry.name.endsWith('.md') && !entry.parentPath.includes('.vitepress'),
  )
  .map((entry: Readonly<Dirent>) => join(entry.parentPath, entry.name));

await test('every page marks a passage for another reader only in the forms a guide reads', () => {
  assert.ok(pages.includes(join(docs, 'reference/workflow-format.md')));
  assert.deepEqual(
    pages.flatMap((page) =>
      markingFaultsOf(readFileSync(page, 'utf8')).map((fault) => `${relative(docs, page)}: ${fault}`),
    ),
    [],
  );
});

await test('a page whose marking a guide cannot read is refused, at its line', () => {
  assert.deepEqual(
    markingFaultsOf(
      [
        '<div v-pre>',
        '',
        '# Example',
        '',
        'A clause<span data-audience="admin"> for no one</span>.',
        '',
        '</div>',
        '',
      ].join('\n'),
    ),
    [
      'The line "A clause<span data-audience="admin"> for no one</span>." names no audience a page may name in data-audience="admin": name one or more of operator, developer, user, each once and separated by one space.',
    ],
  );
});

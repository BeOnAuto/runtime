import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  functionCategoryLabels,
  functionDescriptions,
  functionTypeOrder,
  functionResourceLabels,
} from '@on.auto/definitions';

import {
  checkFunctionTaxonomy,
  functionTaxonomyDocument,
  runFunctionTaxonomy,
  writeFunctionTaxonomy,
} from './docs-function-taxonomy.ts';

function withTemporaryAsset(verify: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-taxonomy-'));
  try {
    verify(join(directory, 'assets', 'brain-functions.json'));
  } finally {
    rmSync(directory, { recursive: true });
  }
}

await test('the published taxonomy comes from the runtime metadata in canonical order', () => {
  const document: unknown = JSON.parse(functionTaxonomyDocument);
  assert.deepEqual(document, {
    schema: 2,
    source: '@on.auto/definitions',
    functions: functionTypeOrder.map((type) => ({
      type,
      label: functionCategoryLabels[type],
      singular: functionResourceLabels[type].singular,
      plural: functionResourceLabels[type].plural,
      description: functionDescriptions[type],
    })),
  });
  assert.deepEqual(functionTypeOrder, ['reasoning', 'interaction', 'prediction', 'recall', 'computation']);
  assert.ok(functionTaxonomyDocument.endsWith('\n'));
});

await test('generation creates directories and preserves an unchanged asset for watchers', () => {
  withTemporaryAsset((path) => {
    assert.equal(writeFunctionTaxonomy(path), 'updated');
    assert.equal(readFileSync(path, 'utf8'), functionTaxonomyDocument);
    utimesSync(path, 100, 100);
    const modified = statSync(path).mtimeMs;
    assert.equal(writeFunctionTaxonomy(path), 'unchanged');
    assert.equal(statSync(path).mtimeMs, modified);
    writeFileSync(path, '{}\n');
    assert.equal(writeFunctionTaxonomy(path), 'updated');
    checkFunctionTaxonomy(path);
  });
});

await test('checking rejects missing and stale assets without writing them', () => {
  withTemporaryAsset((path) => {
    assert.throws(() => {
      checkFunctionTaxonomy(path);
    }, /Run pnpm docs:taxonomy/u);
    assert.equal(existsSync(path), false);
    writeFunctionTaxonomy(path);
    writeFileSync(path, '{}\n');
    assert.throws(() => {
      checkFunctionTaxonomy(path);
    }, /missing or stale/u);
    assert.equal(readFileSync(path, 'utf8'), '{}\n');
  });
});

await test('the command supports generation and a read-only freshness check', () => {
  withTemporaryAsset((path) => {
    runFunctionTaxonomy([], path);
    runFunctionTaxonomy(['--check'], path);
    for (const commandArguments of [['--write'], ['--check', '--check']]) {
      assert.throws(() => {
        runFunctionTaxonomy(commandArguments, path);
      }, /Usage:/u);
    }
  });
});

await test('the executable checks the committed asset against the runtime exports', () => {
  execFileSync(process.execPath, [resolve(import.meta.dirname, 'docs-function-taxonomy.ts'), '--check']);
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { Schema } from 'effect';

import { checkProviders, providersDocument, runProviders, shippedProviders, writeProviders } from './docs-providers.ts';

const decodeListed = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      schema: Schema.Literal(1),
      source: Schema.Literal('@on.auto/providers'),
      providers: Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String })),
    }),
  ),
);

function withTemporaryAsset(verify: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-providers-'));
  try {
    verify(join(directory, 'assets', 'providers.json'));
  } finally {
    rmSync(directory, { recursive: true });
  }
}

await test('the asset publishes every shipped provider, by name, in the order the runtime lists them', () => {
  assert.deepEqual(
    decodeListed(providersDocument).providers,
    shippedProviders.providers.map(({ entry }) => ({ name: entry.name, title: entry.title })),
  );
  assert.ok(providersDocument.endsWith('\n'));
});

await test('generation creates directories and preserves an unchanged asset for watchers', () => {
  withTemporaryAsset((path) => {
    assert.equal(writeProviders(path), 'updated');
    assert.equal(readFileSync(path, 'utf8'), providersDocument);
    utimesSync(path, 100, 100);
    const modified = statSync(path).mtimeMs;
    assert.equal(writeProviders(path), 'unchanged');
    assert.equal(statSync(path).mtimeMs, modified);
    writeFileSync(path, '{}\n');
    assert.equal(writeProviders(path), 'updated');
    checkProviders(path);
  });
});

await test('checking rejects missing and stale assets without writing them', () => {
  withTemporaryAsset((path) => {
    assert.throws(() => {
      checkProviders(path);
    }, /Run pnpm docs:providers/u);
    assert.equal(existsSync(path), false);
    writeProviders(path);
    writeFileSync(path, '{}\n');
    assert.throws(() => {
      checkProviders(path);
    }, /missing or stale/u);
    assert.equal(readFileSync(path, 'utf8'), '{}\n');
  });
});

await test('the command supports generation and a read-only freshness check', () => {
  withTemporaryAsset((path) => {
    runProviders([], path);
    runProviders(['--check'], path);
    for (const commandArguments of [['--write'], ['--check', '--check']]) {
      assert.throws(() => {
        runProviders(commandArguments, path);
      }, /Usage:/u);
    }
  });
});

await test('the executable checks the committed asset against the shipped entries', () => {
  execFileSync(process.execPath, [resolve(import.meta.dirname, 'docs-providers.ts'), '--check']);
});

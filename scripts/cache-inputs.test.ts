import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { Schema } from 'effect';

const root = resolve(import.meta.dirname, '..');
const configurationOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      tasks: Schema.Record(Schema.String, Schema.Struct({ inputs: Schema.optionalKey(Schema.Array(Schema.String)) })),
    }),
  ),
);

const folders = ['packages', 'capabilities']
  .flatMap((parent) => readdirSync(join(root, parent)).map((name) => `${parent}/${name}`))
  .filter((folder) => existsSync(join(root, folder, 'src')));

function readsDocumentation(folder: string): boolean {
  const sources = join(root, folder, 'src');
  return readdirSync(sources, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .some((file) =>
      /docs[/"']|(?:pageOf|fencedBlocksOf|blocksInOrderOf)\(/u.test(readFileSync(join(sources, file), 'utf8')),
    );
}

function missingInputs(folder: string): string[] {
  const config = join(root, folder, 'turbo.json');
  const tasks = existsSync(config) ? configurationOf(readFileSync(config, 'utf8')).tasks : {};
  return ['test', ...('test:shard' in tasks ? ['test:shard'] : [])]
    .filter((task) => tasks[task]?.inputs?.includes('$TURBO_ROOT$/docs/**') !== true)
    .map((task) => `${folder}#${task}`);
}

await test('tests that read documentation declare it as an input of their cached result, including shards', () => {
  assert.deepEqual(
    folders.filter((folder) => readsDocumentation(folder)).flatMap((folder) => missingInputs(folder)),
    [],
  );
});

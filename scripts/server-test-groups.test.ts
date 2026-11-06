import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { matchesGlob, relative, resolve } from 'node:path';
import { test } from 'node:test';

import { Schema } from 'effect';

const server = resolve(import.meta.dirname, '../packages/server');
const groups = ['a-c', 'd-l', 'm-r', 's-z'];
const patternsOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const filesOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ file: Schema.String }))));
const includes = groups.map((group) =>
  patternsOf(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import config from './vitest.groups.ts'; console.log(JSON.stringify(config.test.include));",
      ],
      { cwd: server, env: { ...process.env, SERVER_TEST_GROUP: group }, encoding: 'utf8' },
    ),
  ),
);

await test('every server test belongs to exactly one independently cached group', () => {
  const tests = filesOf(
    execFileSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly', '--json'], { cwd: server, encoding: 'utf8' }),
  ).map(({ file }) => relative(server, file));
  assert.ok(tests.length > 300);
  for (const file of tests) {
    const matching = includes.filter((patterns) => patterns.some((pattern) => matchesGlob(file, pattern)));
    assert.equal(matching.length, 1, `${file} must run once`);
  }
});

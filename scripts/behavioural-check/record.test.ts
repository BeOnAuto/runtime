import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Answer } from './models.ts';
import { appendRow, resultOf, rowsIn, tableOf, type Row } from './record.ts';

function answered(stdout: string): Answer {
  return { exit: 0, stdout, stderr: '', seconds: 1 };
}

const judged = '{"definitions":[{"type":"reasoning","name":"judge","tools":[]},{"type":"workflow","calls":["judge"]}]}';

const row: Row = {
  label: 'before-the-change',
  date: '2026-11-11T12:00:00.000Z',
  profile: 'listing',
  server_name: 'auto',
  starter: 'Use auto to list my playbooks.',
  models: { claude: { command: ['claude', '-p'], version: '2.1.322' } },
  texts: ['a'.repeat(64)],
  prompts: { J1: 'b'.repeat(64) },
  results: {
    claude: {
      J1: resultOf('J', [answered(judged)]),
      C1: resultOf('C', [answered('I cannot say.')]),
    },
  },
};

function withTemporaryRecord(verify: (path: string) => void): void {
  const folder = mkdtempSync(join(tmpdir(), 'behavioural-check-record-'));
  try {
    verify(join(folder, 'results.jsonl'));
  } finally {
    rmSync(folder, { recursive: true });
  }
}

await test('a result keeps the types of the plan in order, what its functions name and call, and the outcome', () => {
  assert.deepEqual(resultOf('J', [answered(judged)]), {
    types: ['reasoning', 'workflow'],
    reasoning_names_tools: [false],
    workflow_calls: [1],
    loaded: [],
    outcome: 'right',
  });
  assert.deepEqual(resultOf('C', [answered('I cannot say.')]), {
    types: null,
    reasoning_names_tools: [],
    workflow_calls: [],
    loaded: [],
    outcome: 'no answer',
  });
  assert.deepEqual(resultOf('J', []).outcome, 'no answer');
});

await test('a result asked again after loading tools keeps the tools loaded and grades the second answer', () => {
  const result = resultOf('J', [answered('{"load":["create_definition"]}'), answered(judged)]);

  assert.deepEqual(result.loaded, ['create_definition']);
  assert.equal(result.outcome, 'right');
});

await test('a row is added to the end of the record, one line each, and read back as it was', () => {
  withTemporaryRecord((path) => {
    assert.deepEqual(rowsIn(path), []);
    appendRow(path, row);
    appendRow(path, { ...row, label: 'after-the-change', note: 'The same briefs on the changed words.' });

    assert.deepEqual(
      rowsIn(path).map(({ label }) => label),
      ['before-the-change', 'after-the-change'],
    );
    assert.deepEqual(rowsIn(path)[0], row);
    assert.equal(readFileSync(path, 'utf8').split('\n').length, 3);
  });
});

await test('a row is never changed: a label already in the record is refused', () => {
  withTemporaryRecord((path) => {
    appendRow(path, row);

    assert.throws(() => {
      appendRow(path, row);
    }, /already holds a row labelled before-the-change; a row is never changed/u);
    assert.equal(rowsIn(path).length, 1);
  });
});

await test('a row is shown as a table of each brief by each model, with how many were right', () => {
  assert.equal(
    tableOf({
      ...row,
      models: {},
      results: { ...row.results, codex: { C1: resultOf('C', [answered('{"definitions":[{"type":"computation"}]}')]) } },
    }),
    [
      'before-the-change (listing, 2026-11-11T12:00:00.000Z)',
      '| brief | claude | codex |',
      '| --- | --- | --- |',
      '| C1 | none | right |',
      '| J1 | right | - |',
      '| right | 1/2 | 1/1 |',
    ].join('\n'),
  );
});

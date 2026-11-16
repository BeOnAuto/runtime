import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { agentTextsRecordIn, agentTextsRecordOf, bytesOf, bytesOfEveryText, placesIn } from './agent-texts-record.ts';

const written = {
  about: 'What the record is.',
  tiers: { '1': 'Always received.', '3': 'Every other text.' },
  texts: [
    {
      sha256: 'one',
      tier: 1,
      received: [
        { as: 'instructions', on: ['/mcp', '/directory'] },
        { as: 'tool tally: title', on: ['/mcp'] },
      ],
      lines: ['Tally'],
    },
    { sha256: 'two', tier: 3, received: [{ as: 'guide tally', on: ['/mcp'] }], lines: ['# Tally', '', 'Counts é.'] },
  ],
};

await test('a record gives each place an agent receives a text, with the text and its tier', () => {
  assert.deepEqual(placesIn(agentTextsRecordOf(JSON.stringify(written))), [
    { as: 'instructions', on: '/mcp', tier: 1, text: 'Tally' },
    { as: 'instructions', on: '/directory', tier: 1, text: 'Tally' },
    { as: 'tool tally: title', on: '/mcp', tier: 1, text: 'Tally' },
    { as: 'guide tally', on: '/mcp', tier: 3, text: '# Tally\n\nCounts é.' },
  ]);
});

await test('a text is measured in bytes of UTF-8, and the record counts each of its texts once', () => {
  assert.equal(bytesOf('Counts é.'), 10);
  assert.equal(bytesOfEveryText(agentTextsRecordOf(JSON.stringify(written))), 5 + 19);
});

await test('a record is read from its file, and a file that is not one is refused', () => {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-agent-texts-record-'));
  try {
    const path = join(directory, 'agent-texts.json');
    writeFileSync(path, JSON.stringify(written));
    assert.equal(agentTextsRecordIn(path).texts.length, 2);
    writeFileSync(path, JSON.stringify({ ...written, texts: [{ tier: 4, received: [], lines: [] }] }));
    assert.throws(() => agentTextsRecordIn(path));
  } finally {
    rmSync(directory, { recursive: true });
  }
});

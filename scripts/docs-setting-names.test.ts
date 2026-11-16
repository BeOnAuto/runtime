import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import type { AgentTextsRecord } from './agent-texts-record.ts';
import { checkSettingNames, findingsIn, problemsIn, runSettingNames, textsNotYetClean } from './docs-setting-names.ts';

function recordOf(texts: Readonly<Record<string, string>>): AgentTextsRecord {
  return {
    tiers: {},
    texts: Object.entries(texts).map(([as, text]: readonly [string, string]) => ({
      tier: 3,
      received: [{ as, on: ['/mcp', '/directory'] }],
      lines: text.split('\n'),
    })),
  };
}

const names = ['MODEL_GATEWAYS', 'PORT', 'tool_servers', 'connections', 'license', 'https_proxy'];

await test('a name the server declares is found wherever it stands whole, in prose, a table or an example', () => {
  const record = recordOf({
    'guide a': [
      'The gateways of `MODEL_GATEWAYS` serve it. Nothing else here.',
      '| Bound | Setting |',
      '| One | `PORT`, from 1 to 9 |',
      '```yaml',
      'tool_servers:',
      '```',
      'Set $https_proxy first.',
    ].join('\n'),
  });
  assert.deepEqual(findingsIn(record, names), [
    { text: 'guide a', name: 'MODEL_GATEWAYS', sentence: 'The gateways of `MODEL_GATEWAYS` serve it.' },
    { text: 'guide a', name: 'PORT', sentence: '| One | `PORT`, from 1 to 9 |' },
    { text: 'guide a', name: 'tool_servers', sentence: 'tool_servers:' },
    { text: 'guide a', name: 'https_proxy', sentence: 'Set $https_proxy first.' },
  ]);
});

await test('a name inside a longer name, or a path into something else, is not the name', () => {
  const record = recordOf({
    'tool a: description':
      'Reads MODEL_GATEWAYS_EXTRA, the PORT-forward, a REPORT, use.tool_servers and /tool_servers/x.',
  });
  assert.deepEqual(findingsIn(record, names), []);
});

await test('a name that is also an ordinary word counts only where it is written as a name: as code, or with a field after a dot', () => {
  const record = recordOf({
    'tool list_connections: title': 'List connections',
    'tool activate_license: description': 'Activates the license. Its connections, members and billing.',
    'guide glance': 'Open `/connections` or use.connections.',
    'guide terminology': 'connections.registered_clients in the settings file holds them. Set `license` once.',
  });
  assert.deepEqual(findingsIn(record, names), [
    {
      text: 'guide terminology',
      name: 'connections',
      sentence: 'connections.registered_clients in the settings file holds them.',
    },
    { text: 'guide terminology', name: 'license', sentence: 'Set `license` once.' },
  ]);
});

await test('a text that names a setting and is not on the list fails, and so does a text on the list that names none', () => {
  const findings = findingsIn(recordOf({ 'guide a': 'Set `PORT`.', 'guide b': 'Set `PORT`.' }), names);
  assert.deepEqual(problemsIn(findings, ['guide a', 'guide c']), [
    'guide b names the setting PORT in: Set `PORT`.',
    'guide c names no setting now: take it off textsNotYetClean in scripts/docs-setting-names.ts',
  ]);
  assert.deepEqual(problemsIn(findings, ['guide a', 'guide b']), []);
  assert.throws(
    () => {
      checkSettingNames(recordOf({ 'guide b': 'Set `PORT`.' }), names, []);
    },
    {
      message:
        'A text an agent reads names a setting the server declares, or a text on the list of those not yet clean is clean:\n- guide b names the setting PORT in: Set `PORT`.',
    },
  );
  assert.doesNotThrow(() => {
    checkSettingNames(recordOf({ 'guide b': 'Set the port.' }), names, []);
  });
});

await test('the command checks the record it is given against the list, and takes no argument', () => {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-setting-names-'));
  try {
    const path = join(directory, 'agent-texts.json');
    writeFileSync(path, JSON.stringify(recordOf({ 'guide a': 'Set `PORT`.' })));
    assert.throws(() => {
      runSettingNames([], path, names);
    }, /guide a names the setting PORT in: Set `PORT`\./u);
    assert.throws(() => {
      runSettingNames(['--check'], path, names);
    }, /^Error: Usage: pnpm docs:setting-names:check$/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

await test('the list of texts not yet clean is in order, each once', () => {
  assert.deepEqual(textsNotYetClean, [...new Set(textsNotYetClean)].toSorted());
});

await test('the committed record names no setting the server declares beyond the texts on the list, and each of those does', () => {
  execFileSync(process.execPath, [resolve(import.meta.dirname, 'docs-setting-names.ts')]);
});

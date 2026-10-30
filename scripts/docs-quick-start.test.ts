import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import manifest from '../package.json' with { type: 'json' };

const docs = resolve(import.meta.dirname, '../docs');

await test('the local quick start connects an agent with one MCP entry, lets it set up the key and leads to the first tutorial, and the README links to the documentation', () => {
  const readme = readFileSync(join(docs, '../README.md'), 'utf8');
  assert.ok(readme.includes('](https://on.auto/docs/)'));
  const guide = readFileSync(join(docs, 'get-started/local.md'), 'utf8');
  assert.match(guide, /^# Run Auto on your computer$/mu);
  const walkthrough = [
    '## Before you start',
    '## 1. Add Auto to your agent',
    `npx -y @on.auto/runtime@${manifest.version} mcp`,
    'downloads that release from npm',
    '## 2. Let your agent take it from there',
    'list my playbooks and the models it can use',
    '`~/.auto-runtime/.env`',
    '](../tutorials/first-playbook.md)',
    '## See and control Auto',
    'npx @on.auto/runtime status',
    '## Other ways to run Auto',
    '](../self-host.md)',
    '## If something does not work',
    '](../self-host/troubleshooting.md)',
  ];
  for (const passage of walkthrough) assert.ok(guide.includes(passage), `Missing from the quick start: ${passage}`);
  const positions = walkthrough.map((passage) => guide.indexOf(passage));
  assert.deepEqual(
    positions,
    positions.toSorted((earlier, later) => earlier - later),
  );
  const before = guide.split('## Before you start')[1]?.split('## 1.')[0]?.trim();
  assert.ok(before !== undefined);
  assert.ok(before.includes('`npx`'));
  assert.ok(before.includes('](https://nodejs.org/en/download)'));
  assert.ok(before.length < 300, 'Before you start says only what is needed');
  assert.ok(guide.includes('it is not a model to run'));
  assert.doesNotMatch(guide, /<details>|mcp-remote|Auto Cloud|request-invite|tool_servers/iu);
});

await test('the quick start and the npm README pin the entry to this release, and each release moves the pin', () => {
  const config = readFileSync(join(docs, '../release-please-config.json'), 'utf8');
  for (const file of ['docs/get-started/local.md', 'packages/server/npm/README.md']) {
    assert.ok(
      config.includes(`{ "type": "generic", "path": "${file}" }`),
      `release-please does not move the pin of ${file}`,
    );
    const text = readFileSync(join(docs, '..', file), 'utf8');
    const outsideTheMarkers = text.replaceAll(/x-release-please-start-version[\s\S]*?x-release-please-end/gu, '');
    assert.ok(text.includes(`@on.auto/runtime@${manifest.version} mcp`), `${file} does not pin ${manifest.version}`);
    assert.doesNotMatch(
      outsideTheMarkers,
      /@on\.auto\/runtime@/u,
      `${file} pins a release where release-please does not move it`,
    );
  }
});

await test('the tool server page adds a server with its key kept out of the configuration file', () => {
  const guide = readFileSync(join(docs, 'self-host/tool-servers.md'), 'utf8');
  for (const passage of [
    'Create `auto-runtime.yaml` in the directory you start Auto Runtime in',
    'Authorization: Bearer ${SEARCH_API_KEY}',
    'The key never goes in `auto-runtime.yaml`',
    '](configuration.md#tool-servers)',
    '](../reference/reasoning-format.md#tools)',
  ])
    assert.ok(guide.includes(passage), `Missing from the tool server page: ${passage}`);
  const quickStart = readFileSync(join(docs, 'get-started/local.md'), 'utf8');
  assert.ok(quickStart.includes('](../guides/tools.md)'));
});

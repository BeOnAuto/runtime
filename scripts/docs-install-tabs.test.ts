import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import manifest from '../package.json' with { type: 'json' };

const docs = resolve(import.meta.dirname, '../docs');

const release = `@on.auto/runtime@${manifest.version}`;

const entry = `${release} mcp`;

interface Tab {
  readonly label: string;
  readonly body: string;
}

function connectStepOf(guide: string): string {
  return guide.split('## 1. Add Auto to your agent {#connect-your-agent}')[1]?.split('## 2.')[0] ?? '';
}

function tabsIn(step: string): readonly Tab[] {
  return [...step.matchAll(/```(?:bash|json) \[([^\]]+)\]\n([\s\S]*?)```/gu)].map(
    ([, label = '', body = '']: readonly string[]) => ({ label, body }),
  );
}

function promptIn(step: string): string {
  return /```text\n([\s\S]*?)```/u.exec(step)?.[1] ?? '';
}

await test('the connect step gives a prompt for the agent, then a tab per agent with Claude Code first', () => {
  const step = connectStepOf(readFileSync(join(docs, 'get-started/local.md'), 'utf8'));
  const tabs = tabsIn(step);
  const commands = tabs.slice(0, -1);
  const config: unknown = JSON.parse(String(tabs.at(-1)?.body));

  assert.ok(promptIn(step).includes(`npx -y ${entry}`));
  assert.deepEqual(
    tabs.map(({ label }) => label),
    ['Claude Code', 'Codex', 'Gemini CLI', 'Grok', 'Cursor, Claude Desktop'],
  );
  assert.deepEqual(
    commands.filter(({ body }) => !body.includes(entry)).map(({ label }) => label),
    [],
  );
  assert.deepEqual(config, {
    mcpServers: { 'auto-runtime': { command: 'npx', args: ['-y', release, 'mcp'] } },
  });
  const html = readFileSync(join(docs, '.vitepress/dist/get-started/local.html'), 'utf8');
  const labels = html.match(/class="vp-code-group[^"]*"[^>]*><div class="tabs">([\s\S]*?)<\/div>/u)?.[1];
  assert.ok(labels !== undefined);
  assert.match(labels, /<input[^>]* checked[^>]*><label[^>]*>Claude Code<\/label>/u);
});

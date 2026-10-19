import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettings } from '../settings/settings.ts';

const example = readFileSync(new URL('../../../../auto-runtime.example.yaml', import.meta.url), 'utf8');

const references = {
  GRAPH_API_KEY: 'graph-api-key-4f1d9a7c2b',
  NOTES_API_KEY: 'notes-api-key-90b3e5d1',
  BILLING_API_KEY: 'billing-api-key-17c0a4f8',
  CRM_API_TOKEN: 'crm-api-token-3e6b28d0',
};

function settingAsWritten(key: string): string {
  const lines = example.split('\n');
  const start = lines.indexOf(`# ${key}:`);
  const below = lines.slice(start + 1);
  const end = below.findIndex((line) => !line.startsWith('#   '));
  return [`# ${key}:`, ...below.slice(0, end)].map((line) => line.slice(2)).join('\n');
}

function configFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-example-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

describe('the tool servers and the connections auto-runtime.example.yaml shows', () => {
  it('read as written, an entry that names a provider the connections add among them', () => {
    const path = configFile(`${settingAsWritten('tool_servers')}\n${settingAsWritten('connections')}\n`);

    const { toolServers, providers } = readSettings({ CONFIG_FILE: path, ...references });

    expect(toolServers.servers.map(({ name, provider }) => [name, provider])).toEqual([
      ['graph', null],
      ['notes', null],
      ['billing', null],
      ['accounts', 'crm'],
    ]);
    expect(toolServers.servers[3]).toMatchObject({
      url: 'https://acme.crm.example.com/mcp',
      allowed: ['search_accounts'],
    });
    expect(providers.providers.filter(({ entry }) => entry.name === 'crm')).toMatchObject([
      { address: 'https://{tenant}.crm.example.com/mcp' },
    ]);
  });
});

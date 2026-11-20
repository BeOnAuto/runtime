import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return '';
}

function fileHolding(text: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-receiving-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true });
  });
  const file = join(folder, 'auto-runtime.yaml');
  writeFileSync(file, text);
  return file;
}

describe('the public address services deliver to', () => {
  it('is none by default or where WEBHOOK_URL is empty, so the runtime takes no inbound connection, and an https origin where it is set', () => {
    expect([
      readSettingsOf({}).receiving,
      readSettingsOf({ WEBHOOK_URL: '' }).receiving,
      readSettingsOf({ WEBHOOK_URL: 'https://events.example.com', CONNECTIONS_RECEIVE_EVENTS: '' }).receiving,
    ]).toEqual([
      { overHttp: true, webhookUrl: undefined },
      { overHttp: true, webhookUrl: undefined },
      { overHttp: false, webhookUrl: 'https://events.example.com' },
    ]);
  });

  it('is read from webhook_url of the configuration file, which WEBHOOK_URL wins over', () => {
    const file = fileHolding('webhook_url: https://events.example.com\n');

    expect([
      readSettingsOf({ CONFIG_FILE: file }).receiving.webhookUrl,
      readSettingsOf({ CONFIG_FILE: file, WEBHOOK_URL: 'https://runtime.example.com' }).receiving.webhookUrl,
    ]).toEqual(['https://events.example.com', 'https://runtime.example.com']);
  });

  it.each([
    'http://events.example.com',
    'http://localhost:5555',
    'https://events.example.com/auto',
    'https://events.example.com/',
    'https://events.example.com?key=k-3d9a1f',
    'https://user:k-3d9a1f@events.example.com',
    'events.example.com',
  ])('stops the start at WEBHOOK_URL="%s", naming the setting and never its value', (address) => {
    const error = errorFrom({ WEBHOOK_URL: address });

    expect(error).toContain('InvalidSettingsError');
    expect(error).toContain('WEBHOOK_URL');
    expect(error).not.toContain('k-3d9a1f');
  });

  it('stops the start at a webhook_url of the file it cannot take, naming the key', () => {
    expect(errorFrom({ CONFIG_FILE: fileHolding('webhook_url: http://events.example.com\n') })).toContain(
      'webhook_url',
    );
  });

  it('is named by a variable the runtime reads for itself, which no connection may send', () => {
    expect(errorFrom({ CONNECTIONS: JSON.stringify({ variables: ['WEBHOOK_URL'] }) })).toContain(
      'WEBHOOK_URL is a variable the runtime reads for itself',
    );
  });
});

const tunnelled = 'https://tunnel-5e1c.example.com';

const localModes: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['declared by ACCESS_MODE', { HOST: '0.0.0.0', ACCESS_MODE: 'local', PUBLIC_URL: 'http://localhost:5555' }],
  ['on the loopback with neither PUBLIC_URL nor API_KEYS', { HOST: '127.0.0.1' }],
];

const outOfLocalMode: ReadonlyArray<Readonly<Record<string, string>>> = [
  { PUBLIC_URL: 'https://auto.example.com' },
  { API_KEYS: '[]' },
];

describe('the public address services deliver to, beside local mode', () => {
  it.each(localModes)(
    'stops the start in local mode %s, given as the variable or the file, naming the setting and never its value',
    (_case, local) => {
      const errors = [
        errorFrom({ ...local, WEBHOOK_URL: tunnelled }),
        errorFrom({ ...local, CONFIG_FILE: fileHolding(`webhook_url: ${tunnelled}\n`) }),
      ];

      expect(errors.map((error) => [error.includes('InvalidSettingsError'), error.includes('WEBHOOK_URL')])).toEqual([
        [true, true],
        [true, true],
      ]);
      expect(errors.filter((error) => error.includes('tunnel-5e1c'))).toEqual([]);
    },
  );

  it('is taken on the loopback where the runtime signs people in or takes keys, which end local mode', () => {
    expect(
      outOfLocalMode.map(
        (access) => readSettingsOf({ HOST: '127.0.0.1', WEBHOOK_URL: tunnelled, ...access }).receiving.webhookUrl,
      ),
    ).toEqual([tunnelled, tunnelled]);
  });
});

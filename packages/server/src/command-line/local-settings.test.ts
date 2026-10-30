import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { localSettings } from './local-settings.ts';

const made: string[] = [];

function directoryWith(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-local-settings-'));
  made.push(directory);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(directory, name), text);
  }
  return directory;
}

afterEach(() => {
  for (const directory of made.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('the settings of a server started on this computer', () => {
  it('listen on the loopback address, log for a person and keep the ledger in the home directory', () => {
    const directory = directoryWith({});

    expect(localSettings({}, { directory, home: '/home/ada' })).toEqual({
      HOST: '127.0.0.1',
      LOG_FORMAT: 'console',
      LOG_LEVEL: 'error',
      LEDGER_FILE: '/home/ada/.auto-runtime/ledger.db',
    });
  });

  it('read .env and name auto-runtime.yaml in the current directory, and the shell wins over both', () => {
    const directory = directoryWith({
      '.env': 'ANTHROPIC_API_KEY=from-the-file\nPORT=6000\nLOG_FORMAT=json\n',
      'auto-runtime.yaml': 'allowed_origins: []\n',
    });

    const settings = localSettings({ PORT: '7000', UNSET: undefined }, { directory, home: '/home/ada' });

    expect(settings).toEqual({
      HOST: '127.0.0.1',
      LOG_FORMAT: 'json',
      LOG_LEVEL: 'error',
      LEDGER_FILE: '/home/ada/.auto-runtime/ledger.db',
      CONFIG_FILE: join(directory, 'auto-runtime.yaml'),
      ANTHROPIC_API_KEY: 'from-the-file',
      PORT: '7000',
    });
  });

  it('leave the ledger to DATABASE_URL or LEDGER_FILE when either is given', () => {
    const directory = directoryWith({ '.env': 'DATABASE_URL=postgresql://ledger.example/auto\n' });

    expect(localSettings({}, { directory, home: '/home/ada' })).not.toHaveProperty('LEDGER_FILE');
    expect(
      localSettings({ LEDGER_FILE: 'kept.db' }, { directory: directoryWith({}), home: '/home/ada' }),
    ).toMatchObject({
      LEDGER_FILE: 'kept.db',
    });
  });

  it('keep the ledger in the home directory when DATABASE_URL is empty', () => {
    expect(localSettings({ DATABASE_URL: '' }, { directory: directoryWith({}), home: '/home/ada' })).toMatchObject({
      LEDGER_FILE: '/home/ada/.auto-runtime/ledger.db',
    });
  });
});

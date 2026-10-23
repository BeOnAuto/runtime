import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function usagePingIn(environment: Environment): unknown {
  return readSettingsOf(environment).usagePing;
}

function errorFrom(environment: Environment): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return '';
}

function configFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-usage-ping-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

describe('the usage ping', () => {
  it('is on by default, for a runtime run from its source', () => {
    expect(usagePingIn({})).toEqual({ distribution: 'source' });
  });

  it('names the distribution the image or the npm package marks', () => {
    expect([
      usagePingIn({ RUNTIME_DISTRIBUTION: 'docker' }),
      usagePingIn({ RUNTIME_DISTRIBUTION: 'npx' }),
      usagePingIn({ RUNTIME_DISTRIBUTION: 'homebrew' }),
    ]).toEqual([{ distribution: 'docker' }, { distribution: 'npx' }, { distribution: 'source' }]);
  });

  it.each(['false', 'FALSE', ' false '])('is off where USAGE_PING is %j', (value) => {
    expect(usagePingIn({ USAGE_PING: value })).toBeUndefined();
  });

  it.each(['true', ''])('is on where USAGE_PING is %j', (value) => {
    expect(usagePingIn({ USAGE_PING: value })).toEqual({ distribution: 'source' });
  });

  it('stops the server at start where USAGE_PING is neither true nor false', () => {
    expect(errorFrom({ USAGE_PING: 'off' })).toBe(
      'InvalidSettingsError: The usage ping setting is invalid. USAGE_PING: Expected true or false',
    );
  });
});

describe('the usage ping of a person who asks not to be tracked', () => {
  it.each(['1', 'true', 'yes', 'anything'])('is off where DO_NOT_TRACK is %j', (value) => {
    expect(usagePingIn({ DO_NOT_TRACK: value })).toBeUndefined();
  });

  it.each(['', '0', 'false', 'FALSE'])('stays on where DO_NOT_TRACK is %j', (value) => {
    expect(usagePingIn({ DO_NOT_TRACK: value })).toEqual({ distribution: 'source' });
  });

  it.each(['true', '1', 'TRUE'])('is off where SCARF_NO_ANALYTICS is %j', (value) => {
    expect(usagePingIn({ SCARF_NO_ANALYTICS: value })).toBeUndefined();
  });

  it.each(['', 'false', '0', 'yes'])('stays on where SCARF_NO_ANALYTICS is %j', (value) => {
    expect(usagePingIn({ SCARF_NO_ANALYTICS: value })).toEqual({ distribution: 'source' });
  });

  it('is off where DO_NOT_TRACK asks it, even with USAGE_PING true', () => {
    expect(usagePingIn({ USAGE_PING: 'true', DO_NOT_TRACK: '1' })).toBeUndefined();
  });
});

describe('the usage ping in the configuration file', () => {
  it('is off where the file says usage_ping: false', () => {
    expect(usagePingIn({ CONFIG_FILE: configFile('usage_ping: false\n') })).toBeUndefined();
  });

  it('is as USAGE_PING says, where the environment sets it too', () => {
    expect(usagePingIn({ CONFIG_FILE: configFile('usage_ping: false\n'), USAGE_PING: 'true' })).toEqual({
      distribution: 'source',
    });
  });
});

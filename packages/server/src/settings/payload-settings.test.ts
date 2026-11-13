import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

function configFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-payloads-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

describe('the payload settings', () => {
  it('offload a payload larger than 16384 bytes when nothing is set, or each is set empty', () => {
    expect([
      readSettingsOf({}).payloads,
      readSettingsOf({ PAYLOAD_OFFLOADING: '', PAYLOAD_SIZE_THRESHOLD_BYTES: ' ' }).payloads,
    ]).toEqual([
      { offloading: true, sizeThresholdBytes: 16_384 },
      { offloading: true, sizeThresholdBytes: 16_384 },
    ]);
  });

  it('read whether payloads are offloaded and the size past which they are, in any case and around spaces', () => {
    expect([
      readSettingsOf({ PAYLOAD_OFFLOADING: 'false', PAYLOAD_SIZE_THRESHOLD_BYTES: '4096' }).payloads,
      readSettingsOf({ PAYLOAD_OFFLOADING: ' TRUE ', PAYLOAD_SIZE_THRESHOLD_BYTES: ' 65536 ' }).payloads,
    ]).toEqual([
      { offloading: false, sizeThresholdBytes: 4096 },
      { offloading: true, sizeThresholdBytes: 65_536 },
    ]);
  });

  it('stop the server from starting when both are malformed, naming each and never its value', () => {
    expect(String(errorFrom({ PAYLOAD_OFFLOADING: 'secret-yes', PAYLOAD_SIZE_THRESHOLD_BYTES: 'secret-big' }))).toBe(
      'InvalidSettingsError: The payload settings are invalid. PAYLOAD_OFFLOADING: Expected true or false; PAYLOAD_SIZE_THRESHOLD_BYTES: Expected a whole number from 2048 to 65536, such as 16384',
    );
  });

  it('stop the server from starting when one alone is malformed', () => {
    expect([
      String(errorFrom({ PAYLOAD_OFFLOADING: 'on' })),
      String(errorFrom({ PAYLOAD_SIZE_THRESHOLD_BYTES: '16 KiB' })),
    ]).toEqual([
      'InvalidSettingsError: The payload settings are invalid. PAYLOAD_OFFLOADING: Expected true or false',
      'InvalidSettingsError: The payload settings are invalid. PAYLOAD_SIZE_THRESHOLD_BYTES: Expected a whole number from 2048 to 65536, such as 16384',
    ]);
  });

  it('check the threshold while offloading is off, so a value set is never kept unread and wrong', () => {
    expect(String(errorFrom({ PAYLOAD_OFFLOADING: 'false', PAYLOAD_SIZE_THRESHOLD_BYTES: '1024' }))).toContain(
      'PAYLOAD_SIZE_THRESHOLD_BYTES: Expected a whole number from 2048 to 65536',
    );
  });
});

describe('the payload size threshold', () => {
  it('takes from 2048, the most a page of events shows of a field whole, to 65536, and refuses one byte past either', () => {
    expect([
      readSettingsOf({ PAYLOAD_SIZE_THRESHOLD_BYTES: '2048' }).payloads.sizeThresholdBytes,
      readSettingsOf({ PAYLOAD_SIZE_THRESHOLD_BYTES: '65536' }).payloads.sizeThresholdBytes,
    ]).toEqual([2048, 65_536]);
    expect([
      String(errorFrom({ PAYLOAD_SIZE_THRESHOLD_BYTES: '2047' })),
      String(errorFrom({ PAYLOAD_SIZE_THRESHOLD_BYTES: '65537' })),
    ]).toEqual([
      expect.stringContaining('PAYLOAD_SIZE_THRESHOLD_BYTES: Expected a whole number from 2048 to 65536'),
      expect.stringContaining('PAYLOAD_SIZE_THRESHOLD_BYTES: Expected a whole number from 2048 to 65536'),
    ]);
  });
});

describe('the payload settings in the configuration file', () => {
  it('are read from payload_offloading and payload_size_threshold_bytes, which the environment wins over', () => {
    const path = configFile('payload_offloading: false\npayload_size_threshold_bytes: 32768\n');

    expect([
      readSettingsOf({ CONFIG_FILE: path }).payloads,
      readSettingsOf({ CONFIG_FILE: path, PAYLOAD_OFFLOADING: 'true', PAYLOAD_SIZE_THRESHOLD_BYTES: '8192' }).payloads,
    ]).toEqual([
      { offloading: false, sizeThresholdBytes: 32_768 },
      { offloading: true, sizeThresholdBytes: 8192 },
    ]);
  });

  it('stop the start at the line of a threshold out of its bounds, naming the key and never the value', () => {
    const path = configFile('payload_size_threshold_bytes: 1048576\n');

    expect(String(errorFrom({ CONFIG_FILE: path }))).toBe(
      `ConfigFileInvalid: The configuration file ${path} is invalid: ${path}:1:31 payload_size_threshold_bytes: Expected a value between 2048 and 65536`,
    );
  });
});

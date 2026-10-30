import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { configuredProviders } from './configured-providers.ts';

const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-configured-providers-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the configured model providers', () => {
  it('are the providers whose keys the settings hold', () => {
    expect(configuredProviders({ OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-ant-test' })).toEqual([
      'anthropic',
      'openai',
    ]);
  });

  it('are none without a key', () => {
    expect(configuredProviders({})).toEqual([]);
  });

  it('are read from the environment alone when the configuration file cannot be read', () => {
    const configFile = join(directory, 'broken.yaml');
    writeFileSync(configFile, 'model_gateways: [unclosed\n');

    expect(configuredProviders({ CONFIG_FILE: configFile, OPENAI_API_KEY: 'sk-test' })).toEqual(['openai']);
  });
});

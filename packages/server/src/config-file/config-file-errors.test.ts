import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { saidAtStart } from '../testing/processes/in-process-starts.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const secret = 'sk-live-SECRET-0123456789abcdef';

async function startupLine(configText: string, environment: Readonly<Record<string, string>> = {}): Promise<string> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const configFile = join(ledger.directory, 'auto-runtime.yaml');
  writeFileSync(configFile, configText);
  const { line, exitCode } = await saidAtStart({
    LEDGER_FILE: ledger.fileName,
    CONFIG_FILE: configFile,
    ...environment,
  });
  expect({ exitCode, secret: line.includes(secret) }).toEqual({ exitCode: 1, secret: false });
  return line.replaceAll(configFile, 'auto-runtime.yaml');
}

describe('a configuration file the server cannot use', () => {
  it('stops the start when the file is missing, naming it in one line', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);

    const said = await saidAtStart({ LEDGER_FILE: ledger.fileName, CONFIG_FILE: '/nonexistent/auto-runtime.yaml' });

    expect(said.exitCode).toBe(1);
    expect(said.line).toMatch(
      /^Auto Runtime could not start: ConfigFileInvalid: [^\n]*\/nonexistent\/auto-runtime\.yaml[^\n]*\n$/u,
    );
  });
});

describe('a configuration file the server cannot read as settings', () => {
  it.each<readonly [string, string, readonly string[]]>([
    ['is not YAML', 'model_aliases: [unclosed\n', ['auto-runtime.yaml:2:1']],
    [
      'holds a value its setting does not accept',
      'model_gateways:\n  - name: gateway\n    base_url: 5555\n    colour: blue\n',
      ['auto-runtime.yaml:3:15 model_gateways[0].base_url', 'auto-runtime.yaml:4:13 model_gateways[0].colour'],
    ],
    [
      'refers to a variable that is not set',
      'model_gateways:\n  - name: gateway\n    base_url: https://gateway.example.com/v1\n    api_key: ${GATEWAY_API_KEY}\n',
      ['auto-runtime.yaml:4:14 model_gateways[0].api_key', 'GATEWAY_API_KEY'],
    ],
    [
      'holds a credential instead of a reference to one',
      `model_gateways:\n  - name: gateway\n    base_url: https://gateway.example.com/v1\n    api_key: ${secret}\n`,
      ['auto-runtime.yaml:4:14 model_gateways[0].api_key'],
    ],
    [
      'holds the URL of the ledger database, which only the environment holds',
      `database_url: postgresql://playbooks:${secret}@db.example.com/playbooks\n`,
      ['auto-runtime.yaml:1:15 database_url'],
    ],
  ])('stops the start when it %s, naming the line and the key and never a value', async (_, text, places) => {
    const line = await startupLine(text);

    expect(line).toMatch(/^Auto Runtime could not start: ConfigFileInvalid: [^\n]+\n$/u);
    expect(places.filter((place) => !line.includes(place))).toEqual([]);
  });

  it('stops the start at the line of a setting the model settings refuse', async () => {
    const text = `model_gateways:
  - name: gateway
    base_url: https://a.example.com/v1
  - name: gateway
    base_url: ftp://b.example.com
`;

    const line = await startupLine(text, { MODEL_ALIASES: '{"fast":"gemini"}' });

    expect(line).toMatch(/^Auto Runtime could not start: model_settings_invalid: /u);
    expect(
      [
        'auto-runtime.yaml:4:11 model_gateways[1].name',
        'auto-runtime.yaml:5:15 model_gateways[1].base_url',
        'MODEL_ALIASES: /fast',
      ].filter((place) => !line.includes(place)),
    ).toEqual([]);
  });
});

describe('declared and allowed models the server refuses', () => {
  it('stops the start at the line of a declared or allowed model the model settings refuse', async () => {
    const text = `declared_models:
  anthropic:
    - claude-sonnet-4-5
  azure:
    - gpt 5
allowed_models: []
`;

    const line = await startupLine(text);

    expect(line).toMatch(/^Auto Runtime could not start: model_settings_invalid: /u);
    expect(
      [
        'auto-runtime.yaml:3:5 declared_models.anthropic',
        'auto-runtime.yaml:5:7 declared_models.azure[0]',
        'auto-runtime.yaml:6:17 allowed_models',
      ].filter((place) => !line.includes(place)),
    ).toEqual([]);
  });
});

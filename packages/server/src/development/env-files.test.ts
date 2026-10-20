import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { providerStatus } from '@on.auto/reasoning';
import { describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';
import { stoppedWith } from '../testing/processes/development-endings.ts';
import {
  developmentFiles,
  readyNoticesOf,
  startDevelopment,
  untilListening,
  untilWritten,
  type DevelopmentOptions,
} from '../testing/processes/development-process.ts';

const example = new URL('../../../../.env.example', import.meta.url);

const devEnv = new URL('../../dev.env', import.meta.url);

const exampleConfigFile = fileURLToPath(new URL('../../../../auto-runtime.example.yaml', import.meta.url));

const localModeNotice = '"message":"Local mode is on:';

const closedNotice = '"message":"No request can authenticate:';

async function accessNoticeWith(localEnvFile: string, options: DevelopmentOptions): Promise<string> {
  const files = developmentFiles('HOST=127.0.0.1\nAPI_KEYS=[]\n');
  writeFileSync(files.localEnvFile, localEnvFile);
  const development = startDevelopment(files, options);
  await untilListening(development);
  await stoppedWith(development, 'SIGTERM');
  return [localModeNotice, closedNotice].filter((notice) => development.stderr().includes(notice)).join();
}

function uncommented(text: string): string {
  return text.replaceAll(/^# (?=[A-Z_]+=)/gmu, '');
}

describe('local Studio under pnpm dev', () => {
  it('allows the local Studio origins in local mode while refusing an unrelated browser origin', async () => {
    const development = startDevelopment(developmentFiles(readFileSync(devEnv, 'utf8')));
    const port = await untilListening(development);

    await Promise.all(
      ['http://localhost:3200', 'http://127.0.0.1:3200'].map(async (origin) => {
        const response = await fetch(`http://127.0.0.1:${port}/v1/orgs/local/playbooks`, { headers: { origin } });
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBe(origin);
        expect(await response.json()).toEqual({ playbooks: [] });
      }),
    );

    const refused = await fetch(`http://127.0.0.1:${port}/v1/orgs/local/playbooks`, {
      headers: { origin: 'http://unrelated.example' },
    });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    await refused.arrayBuffer();
    await stoppedWith(development, 'SIGTERM');
  });
});

describe('the settings files pnpm dev reads', () => {
  it('run the server in local mode with dev.env alone, on a loopback address with neither PUBLIC_URL nor API_KEYS', () => {
    expect(readSettings(parseEnv(readFileSync(devEnv, 'utf8')))).toMatchObject({
      host: '127.0.0.1',
      apiKeys: undefined,
      signIn: undefined,
    });
  });

  it('lets .env override dev.env', async () => {
    await expect(accessNoticeWith('API_KEYS=\n', {})).resolves.toBe(localModeNotice);
  });

  it('lets a variable set in the shell win over both files', async () => {
    await expect(accessNoticeWith('API_KEYS=\n', { environment: { API_KEYS: '[]' } })).resolves.toBe(closedNotice);
  });

  it('documents the model settings in .env.example and auto-runtime.example.yaml in a form that reads as written', () => {
    const environment = parseEnv(uncommented(readFileSync(example, 'utf8')));

    const { models, allowedOrigins, configFile } = readSettings({ ...environment, CONFIG_FILE: exampleConfigFile });

    expect(providerStatus(models, { entraId: false }).configured).toEqual(['anthropic', 'openai', 'google', 'gateway']);
    expect(Object.fromEntries(models.aliases)).toEqual({ 'anthropic/*': 'gateway/anthropic/*' });
    expect(allowedOrigins).toEqual(['http://localhost:5173']);
    expect(configFile?.fromFile).toEqual(['MODEL_GATEWAYS', 'MODEL_ALIASES', 'ALLOWED_ORIGINS']);
  });

  it('documents the ledger in PostgreSQL in .env.example in a form that reads as written over dev.env', () => {
    const environment = parseEnv(uncommented(readFileSync(example, 'utf8')));

    const { ledger } = readSettings({ LEDGER_FILE: '.data/ledger.db', ...environment });

    expect(ledger).toMatchObject({ store: 'postgresql', host: '127.0.0.1:5432', database: 'postgres' });
  });
});

describe('the configuration file pnpm dev passes', () => {
  it('is auto-runtime.yaml at the root of the repository, when it is there', async () => {
    const files = developmentFiles();
    writeFileSync(files.configFile, 'model_aliases:\n  house/fast: anthropic/claude-haiku-4-5\n');
    const development = startDevelopment(files);

    await untilListening(development);
    await stoppedWith(development, 'SIGTERM');

    expect(development.stderr()).toContain(
      `"message":"Settings read from the configuration file ${files.configFile}: MODEL_ALIASES"`,
    );
  });

  it('is the one CONFIG_FILE names instead, which the ready notice reads too', async () => {
    const files = developmentFiles();
    const named = join(files.directory, 'gateways.yaml');
    writeFileSync(files.configFile, 'model_aliases:\n  house/fast: anthropic/claude-haiku-4-5\n');
    writeFileSync(named, 'model_gateways:\n  - name: relay\n    base_url: https://relay.example.com/v1\n');
    writeFileSync(files.localEnvFile, `CONFIG_FILE=${named}\n`);
    const development = startDevelopment(files);

    await untilWritten(development.stderr, /Auto Runtime is ready/u);
    await stoppedWith(development, 'SIGTERM');

    expect(development.stderr()).toContain(
      `"message":"Settings read from the configuration file ${named}: MODEL_GATEWAYS"`,
    );
    expect(readyNoticesOf(development)).toEqual([expect.stringContaining('  models     relay\n')]);
  });
});

describe('pnpm dev with LOG_FORMAT=pretty in dev.env', () => {
  it("writes its own lines and the server's as readable lines", async () => {
    const development = startDevelopment(developmentFiles('HOST=127.0.0.1\nLOG_FORMAT=pretty\n'));

    const port = await untilListening(development);
    await untilWritten(development.stderr, /\[dev\] Auto Runtime is ready/u);
    await stoppedWith(development, 'SIGTERM');

    expect(
      development
        .stderr()
        .replaceAll(/^\d{2}:\d{2}:\d{2}\.\d{3} /gmu, '')
        .split('\n'),
    ).toEqual([
      expect.stringMatching(/^WARN {2}Local mode is on: /u),
      expect.stringMatching(/^INFO {2}The ledger is kept in the file \S+\/ledger\.db ledger_file=\S+\/ledger\.db$/u),
      "INFO  Content is kept in the ledger's database content_store=ledger",
      expect.stringMatching(
        /^INFO {2}Secrets are kept in the ledger's database, sealed under the key [\da-f]{16} that the file \S+\/secrets\.key holds, and 0 sealed under the previous key were sealed again under it secrets_kid=[\da-f]{16} secrets_resealed=0 secrets_key_from=file$/u,
      ),
      expect.stringMatching(/^WARN {2}No model provider is configured, /u),
      expect.stringMatching(/^INFO {2}Reasoning functions run in this server: the model calls of a run add up to /u),
      expect.stringMatching(/^INFO {2}Prediction functions run in this server: a playbook keeps at most 32 active, /u),
      expect.stringMatching(/^INFO {2}Workflows run in this server: a run lasts at most 30 days, /u),
      'INFO  [dev] Auto Runtime is ready',
      `  server     http://localhost:${port}`,
      '  models     none configured; copy .env.example to .env and put a key in it',
      `  MCP        http://localhost:${port}/mcp`,
      '',
    ]);
  });
});

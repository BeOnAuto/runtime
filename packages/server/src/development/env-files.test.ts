import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

import { providerStatus } from '@on.auto/reasoning';
import { describe, expect, it, vi } from 'vitest';

import { stoppedWith } from '../testing/processes/development-endings.ts';
import {
  developmentFiles,
  startDevelopment,
  untilListening,
  untilWritten,
  type DevelopmentFiles,
} from '../testing/processes/development-process.ts';
import { aRunner, servedAsPnpmDevServesIt, type RunnerParts } from '../testing/processes/pnpm-dev-in-process.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { servedStudioHomeOf, welcomeLinking } from '../testing/studios/welcome.ts';

const example = new URL('../../../../.env.example', import.meta.url);

const devEnv = new URL('../../dev.env', import.meta.url);

const exampleConfigFile = join(import.meta.dirname, '../../../../auto-runtime.example.yaml');

function uncommented(text: string): string {
  return text.replaceAll(/^# (?=[A-Z_]+=)/gmu, '');
}

describe('local Studio under pnpm dev', () => {
  it('allows the local Studio origins in local mode while refusing an unrelated browser origin', async () => {
    const { port } = await servedAsPnpmDevServesIt();

    await Promise.all(
      ['http://localhost:3200', 'http://127.0.0.1:3200'].map(async (origin) => {
        const response = await fetch(`http://127.0.0.1:${port}/v1/orgs/local/playbooks`, { headers: { origin } });
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBe(origin);
        expect(await response.json()).toEqual({
          playbooks: [],
          welcome: welcomeLinking(servedStudioHomeOf(`http://127.0.0.1:${port}`)),
        });
      }),
    );

    const refused = await fetch(`http://127.0.0.1:${port}/v1/orgs/local/playbooks`, {
      headers: { origin: 'http://unrelated.example' },
    });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    await refused.arrayBuffer();
  });
});

describe('the settings files pnpm dev reads', () => {
  it('run the server in local mode with dev.env alone, on a loopback address with neither PUBLIC_URL nor API_KEYS', () => {
    expect(readSettingsOf(parseEnv(readFileSync(devEnv, 'utf8')))).toMatchObject({
      host: '127.0.0.1',
      apiKeys: undefined,
      signIn: undefined,
    });
  });

  it('documents the model settings in .env.example and auto-runtime.example.yaml in a form that reads as written', () => {
    const environment = parseEnv(uncommented(readFileSync(example, 'utf8')));

    const { models, allowedOrigins, configFile } = readSettingsOf({ ...environment, CONFIG_FILE: exampleConfigFile });

    expect(providerStatus(models, { entraId: false }).configured).toEqual(['anthropic', 'openai', 'google', 'gateway']);
    expect(Object.fromEntries(models.aliases)).toEqual({ 'anthropic/*': 'gateway/anthropic/*' });
    expect(allowedOrigins).toEqual(['http://localhost:5173']);
    expect(configFile?.fromFile).toEqual(['MODEL_GATEWAYS', 'MODEL_ALIASES', 'ALLOWED_ORIGINS']);
  });

  it('documents the ledger in PostgreSQL in .env.example in a form that reads as written over dev.env', () => {
    const environment = parseEnv(uncommented(readFileSync(example, 'utf8')));

    const { ledger } = readSettingsOf({ LEDGER_FILE: '.data/ledger.db', ...environment });

    expect(ledger).toMatchObject({ store: 'postgresql', host: '127.0.0.1:5432', database: 'postgres' });
  });
});

/**
 * The server the runner starts over the files, once it said it listens and the runner was stopped, and what the runner
 * logged meanwhile. That node reads the env files it is handed in their order, under the variables of the shell, is
 * node's own; what the runner hands it is the runner's.
 */
async function startedOver(files: DevelopmentFiles, shell: RunnerParts['shell'] = {}) {
  const logged: string[] = [];
  const written = vi.spyOn(console, 'error').mockImplementation((...lines: readonly unknown[]) => {
    logged.push(...lines.map(String));
  });
  try {
    const runner = aRunner({ envFiles: [files.envFile, files.localEnvFile], ...files, shell });
    const server = await runner.child(0);
    server.says('Auto Runtime listening on port 5555\n');
    runner.stopped('SIGTERM');
    expect(await runner.exitCode).toBe(0);
    return { command: server.command, logged: logged.join('') };
  } finally {
    written.mockRestore();
  }
}

describe('the settings files the runner of pnpm dev reads', () => {
  it('are handed to the server dev.env first and .env after it, which node reads in that order under the variables of the shell', async () => {
    const files = developmentFiles();
    writeFileSync(files.localEnvFile, 'API_KEYS=\n');

    const { command } = await startedOver(files, { API_KEYS: '[]' });

    expect(command.args.slice(0, 2)).toEqual([`--env-file=${files.envFile}`, `--env-file=${files.localEnvFile}`]);
    expect(command.environment).toMatchObject({ API_KEYS: '[]' });
  });
});

describe('the configuration file the runner of pnpm dev passes', () => {
  it('is auto-runtime.yaml at the root of the repository, when it is there', async () => {
    const files = developmentFiles();
    writeFileSync(files.configFile, 'model_aliases:\n  house/fast: anthropic/claude-haiku-4-5\n');

    const { command } = await startedOver(files);

    expect(command.environment).toMatchObject({ CONFIG_FILE: files.configFile });
  });

  it('is the one CONFIG_FILE names instead, which the ready notice reads too', async () => {
    const files = developmentFiles();
    const named = join(files.directory, 'gateways.yaml');
    writeFileSync(files.configFile, 'model_aliases:\n  house/fast: anthropic/claude-haiku-4-5\n');
    writeFileSync(named, 'model_gateways:\n  - name: relay\n    base_url: https://relay.example.com/v1\n');
    writeFileSync(files.localEnvFile, `CONFIG_FILE=${named}\n`);

    const { command, logged } = await startedOver(files);

    expect(command.environment['CONFIG_FILE']).toBeUndefined();
    expect(logged).toMatch(/models {5}relay/u);
  });
});

/*
 * The one process of this file: the runner's entry and the server it starts, each writing its lines to the stderr
 * they share in the format dev.env names.
 */
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
      'INFO  Payload offloading is on: a payload larger than 16384 bytes is kept as content, and its record names it by its SHA-256 and its size payload_offloading=true payload_size_threshold_bytes=16384',
      expect.stringMatching(
        /^INFO {2}Secrets are kept in the ledger's database, sealed under the key [\da-f]{16} that the file \S+\/secrets\.key holds, and 0 sealed under the previous key were sealed again under it secrets_kid=[\da-f]{16} secrets_resealed=0 secrets_key_from=file$/u,
      ),
      'INFO  Extensions loaded, in their order of precedence: none extensions=[]',
      expect.stringMatching(/^WARN {2}No model provider is configured, /u),
      expect.stringMatching(/^INFO {2}Reasoning functions run in this server: the model calls of a run add up to /u),
      expect.stringMatching(/^INFO {2}The policy decision point loaded its engine and its policies /u),
      expect.stringMatching(/^INFO {2}Workflows run in this server: a run lasts at most 30 days, /u),
      'INFO  [dev] Auto Runtime is ready',
      `  server     http://localhost:${port}`,
      '  models     none configured; copy .env.example to .env and put a key in it',
      `  MCP        http://localhost:${port}/mcp`,
      '',
    ]);
  });
});

import { fileURLToPath } from 'node:url';

import { withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { localDeveloper } from '@on.auto/identity/testing';
import { afterAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { saidAtStart, startedInProcess } from './testing/processes/in-process-starts.ts';
import { spawnServer } from './testing/processes/spawned-server.ts';
import { messagesOf } from './testing/processes/stderr-lines.ts';
import { temporaryLedger } from './testing/records/temporary-ledger.ts';
import { givenGoals } from './testing/settings/goals-kept.ts';

const mainModule = fileURLToPath(new URL('main.ts', import.meta.url));

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const loopback = {
  HOST: '127.0.0.1',
  PORT: '0',
  LEDGER_FILE: ledger.fileName,
};

const refusedSettings: ReadonlyArray<readonly [Readonly<Record<string, string>>, string]> = [
  [{ ALLOWED_ORIGINS: 'app.example.com' }, 'InvalidSettingsError'],
  [{ API_KEYS: '[{"id":"ci-1"}]' }, 'InvalidApiKeysError'],
  [{ LOG_FORMAT: 'fancy' }, 'InvalidSettingsError'],
  [
    {
      API_KEYS: JSON.stringify([
        createApiKey({ id: 'ci-1', org: 'local', permissions: ['org:read'], playbooks: '*' }).entry,
      ]),
    },
    'InvalidApiKeysError',
  ],
  [{ WORKFLOW_SWEEP_INTERVAL: 'PT2M' }, 'InvalidSettingsError'],
  [{ MODEL_ALIASES: '{"fast":"gemini"}' }, 'model_settings_invalid'],
];

const noModelProvider =
  'No model provider is configured, so reasoning functions cannot run; set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY or MODEL_GATEWAYS';

const decisionPointLoaded = 'The policy decision point loaded its engine and its policies';

const functionsRun: readonly unknown[] = [
  "Reasoning functions run in this server: the model calls of a run add up to at most 2,000,000 input tokens, and each answer of a tool is read whole where it fits the model's context window",
  decisionPointLoaded,
  'Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms',
];

const ledgerKept = `The ledger is kept in the file ${ledger.fileName}`;
const keptIn: readonly unknown[] = [
  ledgerKept,
  "Content is kept in the ledger's database",
  'Payload offloading is on: a payload larger than 16384 bytes is kept as content, and its record names it by its SHA-256 and its size',
  expect.stringMatching(
    /^Secrets are kept in the ledger's database, sealed under the key [\da-f]{16} that the file \S+\/secrets\.key holds, and 0 sealed under the previous key were sealed again under it$/u,
  ),
];

const extensionsLoaded = 'Extensions loaded, in their order of precedence: none';

function startInLocalMode(): readonly unknown[] {
  return [expect.stringMatching(/^Local mode is on: /u), ...keptIn, extensionsLoaded, noModelProvider, ...functionsRun];
}

describe('main', () => {
  it.each<'SIGTERM' | 'SIGINT'>(['SIGTERM', 'SIGINT'])(
    'serves health checks when launched with node, writes exactly the listening line to stdout and its logs as JSON lines to stderr, and exits 0 on %s',
    async (signal) => {
      const child = spawnServer(mainModule, loopback);
      const port = await child.port;

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      child.signal(signal);
      const exitCode = await child.exited;

      expect({ status: health.status, exitCode }).toEqual({ status: 200, exitCode: 0 });
      expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
      expect(child.output().stderr).toMatch(/^\{"message":"Local mode is on: .*"level":"WARN".*\}\n/u);
      expect(messagesOf(child.output().stderr)).toEqual(startInLocalMode());
    },
  );

  it('does not start with a setting it cannot read, naming the error in one line on stderr and writing nothing to stdout', async () => {
    const child = spawnServer(mainModule, { ...loopback, PORT: 'eighty' });

    expect(await child.exited).toBe(1);
    expect(child.output().stdout).toBe('');
    expect(child.output().stderr.split('\n')).toEqual([
      expect.stringMatching(/^Auto Runtime could not start: InvalidPortError: /u),
      '',
    ]);
  });
});

describe('the server main starts, given settings it refuses', () => {
  it.each(refusedSettings)('refuses %o with the error named', async (env, error) => {
    const said = await saidAtStart({ ...loopback, ...env });

    expect(said.exitCode).toBe(1);
    expect(said.line.startsWith(`Auto Runtime could not start: ${error}: `)).toBe(true);
  });
});

const secretOfAGateway = 'sk-gateway-secret-123';

const { key: aKeyAlone } = createApiKey({ id: 'ci-1', org: 'demo', permissions: ['org:read'], playbooks: '*' });

const secretsInRefusedSettings: ReadonlyArray<readonly [string, Readonly<Record<string, string>>, string, string]> = [
  [
    'a secret of the model settings',
    {
      MODEL_GATEWAYS: JSON.stringify([
        { name: 'internal', base_url: 'ftp://llm.example', headers: { 'x-key': secretOfAGateway } },
      ]),
    },
    'model_settings_invalid',
    secretOfAGateway,
  ],
  ['API_KEYS', { API_KEYS: aKeyAlone }, 'InvalidApiKeysError', aKeyAlone],
];

describe('the server main starts, given secrets in settings it cannot read', () => {
  it.each(secretsInRefusedSettings)('does not echo %s', async (_secret, env, error, secret) => {
    const said = await saidAtStart({ ...loopback, ...env });

    expect(said.exitCode).toBe(1);
    expect(said.line.startsWith(`Auto Runtime could not start: ${error}: `)).toBe(true);
    expect(said.line).not.toContain(secret);
  });
});

async function mcpInProcess(): Promise<{ readonly url: string; readonly logged: () => string }> {
  const logged = vi.spyOn(console, 'error');
  onTestFinished(() => {
    logged.mockRestore();
  });
  const server = await startedInProcess(loopback);
  onTestFinished(() => server.stop());
  return {
    url: `http://127.0.0.1:${server.port}/orgs/demo/mcp`,
    logged: () => logged.mock.calls.flat().map(String).join('\n'),
  };
}

describe('the server main starts, over MCP', () => {
  it('serves the playbook tools without a key in local mode', async () => {
    const { url } = await mcpInProcess();

    const playbook = await withMcpSession('current revision', { url, headers: {} }, async (session) => {
      await session.callTool('create_playbook', { playbook: 'support', name: 'Support', goals: givenGoals });
      return session.callTool('list_playbooks', {});
    });

    expect(playbook.structuredContent).toMatchObject({
      playbooks: [{ id: 'support', name: 'Support', created_by: { id: 'local', name: localDeveloper.name } }],
    });
  });

  it('logs what the MCP layer reports as a warning, answering with its JSON-RPC error', async () => {
    const { url, logged } = await mcpInProcess();

    const answer = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', accept: 'application/json, text/event-stream' },
      body: '{}',
    });
    const body: unknown = await answer.json();

    expect({ status: answer.status, body }).toMatchObject({ status: 415, body: { error: { code: -32_000 } } });
    expect(logged()).toMatch(/\{"message":"The MCP layer reported an error","level":"WARN"/u);
  });
});

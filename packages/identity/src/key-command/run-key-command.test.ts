import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { authenticatorFor, readApiKeys } from '../index.ts';
import { principalIn } from '../testing/index.ts';
import { runKeyCommand } from './run-key-command.ts';

interface Session {
  readonly exitCode: number;
  readonly logged: readonly string[];
  readonly errors: readonly string[];
}

function run(...args: readonly string[]): Session {
  const logged: string[] = [];
  const errors: string[] = [];
  const exitCode = runKeyCommand(args, {
    log: (line) => {
      logged.push(line);
    },
    error: (line) => {
      errors.push(line);
    },
  });
  return { exitCode, logged, errors };
}

function issued({ logged }: Session): { readonly key: string; readonly entry: string } {
  return {
    key: logged[0]?.replace('API key, shown only this once: ', '') ?? '',
    entry: logged[1]?.replace('API_KEYS entry: ', '') ?? '',
  };
}

const keyCommand = fileURLToPath(new URL('../key-command.ts', import.meta.url));

const asAProcess: SpawnSyncOptionsWithStringEncoding = {
  encoding: 'utf8',
  env: { NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] },
};

const badArguments: ReadonlyArray<readonly [readonly string[], string]> = [
  [['--id', 'ci-1'], '--org: Missing key'],
  [['--org', 'a b'], '--org: Expected a string matching'],
  [['--org', 'local'], '--org: This org id is reserved for local mode'],
  [['--org', 'acme', '--id', 'local'], '--id: This key id is reserved for the local developer'],
  [['--org', 'acme', '--id', 'CI_1'], '--id: Expected a string matching'],
  [['--org', 'acme', '--permissions', 'org:read,admin'], '--permissions: Expected "org:read"'],
  [['--org', 'acme', '--playbooks', 'Alpha'], '--playbooks: Expected a string matching'],
  [['--org', 'acme', '--colour', 'red'], "Unknown option '--colour'"],
  [['--org', 'acme', 'extra'], "Unexpected argument 'extra'"],
];

describe('the key command', () => {
  it('prints a key once and the API_KEYS entry that admits it, with a random id, every permission and every playbook', async () => {
    const session = run('--org', 'demo');
    const { key, entry } = issued(session);
    const apiKeys = readApiKeys({ API_KEYS: `[${entry}]` });

    expect(session).toMatchObject({ exitCode: 0, errors: [] });
    expect(apiKeys).toMatchObject([
      { org: 'demo', permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'], playbooks: '*' },
    ]);
    expect(apiKeys?.[0]?.id).toMatch(/^[0-9a-f]{8}$/u);
    const holder = principalIn(await authenticatorFor({ host: '0.0.0.0', apiKeys }).authenticate(key, '/mcp'));

    expect(holder?.callerIn('demo')?.org).toBe('demo');
  });

  it('takes the id, the permissions and the playbooks it is given, after an optional --', () => {
    const session = run(
      '--',
      '--org',
      'acme',
      '--id',
      'ci-1',
      '--permissions',
      'playbook:read,org:read',
      '--playbooks',
      'alpha,beta',
    );

    expect(JSON.parse(issued(session).entry)).toMatchObject({
      id: 'ci-1',
      org: 'acme',
      permissions: ['playbook:read', 'org:read'],
      playbooks: ['alpha', 'beta'],
    });
  });

  it('accepts * for every playbook', () => {
    expect(JSON.parse(issued(run('--org', 'acme', '--playbooks', '*')).entry)).toMatchObject({ playbooks: '*' });
  });
});

describe('the key command with bad arguments', () => {
  it.each(badArguments)('rejects %j, saying why and how to call it, and prints no key', (args, reason) => {
    const session = run(...args);

    expect(session.exitCode).toBe(1);
    expect(session.logged).toEqual([]);
    expect(session.errors[0]).toContain(reason);
    expect(session.errors[1]).toMatch(/^Arguments: --org <org id>/u);
  });
});

describe('the key command as a process', () => {
  it('prints the key and the entry to stdout and exits 0', () => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [keyCommand, '--org', 'demo'], asAProcess);

    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    expect(stdout).toMatch(
      /^API key, shown only this once: abk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}\nAPI_KEYS entry: \{.*\}\n$/u,
    );
  });

  it('explains bad arguments on stderr, prints nothing on stdout and exits non-zero', () => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [keyCommand], asAProcess);

    expect({ status, stdout }).toEqual({ status: 1, stdout: '' });
    expect(stderr).toContain('--org: Missing key');
  });
});

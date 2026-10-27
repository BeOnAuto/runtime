import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import type { LocalStarting } from '../local-runtime/local-control.ts';
import { runCommandLine, type CommandLineHost } from './command-line.ts';

const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-command-line-'));

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

interface Recorded {
  readonly host: CommandLineHost;
  readonly logged: string[];
  readonly errors: string[];
  readonly started: Readonly<Record<string, string>>[];
  readonly startedAs: LocalStarting[];
  readonly relayed: number[];
  readonly asked: string[];
}

const runningStatus = {
  version: '0.9.1',
  pid: 4242,
  started_at: '2026-10-14T09:41:07.000Z',
  started_by: 'terminal',
  directory: '/home/ada/playbooks',
  runs_in_flight: 0,
};

function recordedHost(): Recorded {
  const logged: string[] = [];
  const errors: string[] = [];
  const started: Readonly<Record<string, string>>[] = [];
  const startedAs: LocalStarting[] = [];
  const relayed: number[] = [];
  const asked: string[] = [];
  return {
    logged,
    errors,
    started,
    startedAs,
    relayed,
    asked,
    host: {
      environment: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      place: { directory, home: '/home/ada' },
      console: {
        log: (line) => {
          logged.push(line);
        },
        error: (line) => {
          errors.push(line);
        },
      },
      fetch: (address) => {
        asked.push(address);
        return Promise.resolve(Response.json(runningStatus));
      },
      startServer: (settings, starting) => {
        started.push(settings);
        startedAs.push(starting);
        return Promise.resolve();
      },
      relay: (port) => {
        relayed.push(port);
        return Promise.resolve();
      },
    },
  };
}

const startedSettings = {
  HOST: '127.0.0.1',
  LOG_FORMAT: 'console',
  LOG_LEVEL: 'error',
  LEDGER_FILE: '/home/ada/.auto-runtime/ledger.db',
  ANTHROPIC_API_KEY: 'sk-ant-test',
};

describe('starting the server with the auto-runtime command', () => {
  it('starts it when given no command, and leaves the exit code to the server', async () => {
    const { host, started } = recordedHost();

    await expect(runCommandLine([], host)).resolves.toBeUndefined();
    expect(started).toEqual([startedSettings]);
  });

  it('starts it with start, as started in a terminal, which names its own instance', async () => {
    const { host, started, startedAs } = recordedHost();

    await runCommandLine(['start'], host);

    expect(started).toEqual([startedSettings]);
    const [starting] = startedAs;
    expect(starting?.startedBy).toBe('terminal');
    expect(starting?.instance).toMatch(uuid);
  });

  it('starts it in the background for an agent, as the instance the relay that starts it names', async () => {
    const { host, startedAs } = recordedHost();

    await runCommandLine(['start', '--background', '--instance', '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'], host);

    expect(startedAs).toEqual([{ startedBy: 'agent', instance: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' }]);
  });

  it.each<readonly [string, readonly string[]]>([
    ['without an instance', ['start', '--background']],
    ['with an instance that is no id', ['start', '--background', '--instance', 'mine']],
    ['with a word that is not --instance', ['start', '--background', '--name', '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a']],
  ])('starts nothing in the background %s, and says so', async (_case, args) => {
    const { host, startedAs, errors } = recordedHost();

    await expect(runCommandLine(args, host)).resolves.toBe(1);
    expect(startedAs).toEqual([]);
    expect(errors[0]).toBe(`auto-runtime has no command "${args.join(' ')}"`);
  });
});

describe('the commands of auto-runtime for the runtime on this computer', () => {
  it('relays an agent to the runtime on port 5555 with mcp, and ends well once the agent leaves', async () => {
    const { host, relayed } = recordedHost();

    await expect(runCommandLine(['mcp'], host)).resolves.toBe(0);
    expect(relayed).toEqual([5555]);
  });

  it('asks the runtime on this computer for its status', async () => {
    const { host, logged, asked } = recordedHost();

    await expect(runCommandLine(['status'], host)).resolves.toBe(0);
    expect(asked).toEqual(['http://127.0.0.1:5555/runtime']);
    expect(logged[0]).toBe('Auto Runtime 0.9.1 is running at http://localhost:5555');
  });

  it('asks the runtime on this computer to activate its license with license activate and a key', async () => {
    const { host, asked } = recordedHost();

    await runCommandLine(['license', 'activate', 'alk.acme.one.secret'], host);

    expect(asked).toEqual(['http://127.0.0.1:5555/runtime', 'http://127.0.0.1:5555/v1/orgs/local/license']);
  });

  it('has no command license without activate and a key', async () => {
    const { host, errors } = recordedHost();

    await expect(runCommandLine(['license', 'show', 'alk.acme.one.secret'], host)).resolves.toBe(1);
    expect(errors[0]).toBe('auto-runtime has no command "license show alk.acme.one.secret"');
  });
});

describe('the other commands of auto-runtime', () => {
  it('issues an API key with key', async () => {
    const { host, logged } = recordedHost();

    await expect(runCommandLine(['key', '--org', 'acme'], host)).resolves.toBe(0);
    expect(logged[0]).toMatch(/^API key, shown only this once: abk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/u);
    expect(logged[1]).toMatch(/^API_KEYS entry: \{"id":"[0-9a-f]{8}","sha256":"[0-9a-f]{64}","org":"acme",/u);
  });

  it('refuses a key without an org, as the key command does', async () => {
    const { host, errors } = recordedHost();

    await expect(runCommandLine(['key'], host)).resolves.toBe(1);
    expect(errors.at(-1)).toMatch(/^Arguments: --org <org id>/u);
  });

  it('prints the release version with --version', async () => {
    const { host, logged } = recordedHost();

    await expect(runCommandLine(['--version'], host)).resolves.toBe(0);
    expect(logged).toEqual([release.version]);
  });

  it('prints its commands with --help', async () => {
    const { host, logged } = recordedHost();

    await expect(runCommandLine(['--help'], host)).resolves.toBe(0);
    expect(logged[0]).toMatch(/^Usage: auto-runtime \[command\]\n/u);
    expect(logged[0]).toContain('http://localhost:5555');
    expect(logged[0]).toContain(
      '\nOn this computer every request is trusted as you, with no sign-in.\nPUBLIC_URL=http://localhost:5555 signs people in through the Auto identity service instead.\n',
    );
  });
});

describe('what the auto-runtime command refuses', () => {
  it('refuses a command it does not have with its help', async () => {
    const { host, errors } = recordedHost();

    await expect(runCommandLine(['serve', '--now'], host)).resolves.toBe(1);
    expect(errors[0]).toBe('auto-runtime has no command "serve --now"');
    expect(errors[1]).toMatch(/^Usage: auto-runtime/u);
  });

  it('refuses arguments after start, since settings are environment variables', async () => {
    const { host, errors, started } = recordedHost();

    await expect(runCommandLine(['start', '--port', '6000'], host)).resolves.toBe(1);
    expect(errors[0]).toBe('auto-runtime has no command "start --port 6000"');
    expect(started).toEqual([]);
  });

  it('refuses arguments after mcp or status', async () => {
    const { host, relayed } = recordedHost();

    await expect(runCommandLine(['mcp', '--port', '6000'], host)).resolves.toBe(1);
    await expect(runCommandLine(['status', '--json'], host)).resolves.toBe(1);
    expect(relayed).toEqual([]);
  });

  it('refuses a name that only an object has', async () => {
    const { host } = recordedHost();

    await expect(runCommandLine(['toString'], host)).resolves.toBe(1);
  });
});

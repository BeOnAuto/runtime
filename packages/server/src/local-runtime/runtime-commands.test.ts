import { describe, expect, it } from 'vitest';

import { runRuntimeCommand, type RuntimeAsking, type RuntimeCommand } from './runtime-commands.ts';
import type { RuntimeFetch } from './runtime-probe.ts';

const runningInATerminal = {
  version: '0.9.1',
  pid: 4242,
  started_at: '2026-10-14T09:41:07.000Z',
  started_by: 'terminal',
  directory: '/Users/ada/playbooks',
  runs_in_flight: 0,
};

const runningForAnAgent = {
  ...runningInATerminal,
  started_by: 'agent',
  directory: '/Users/ada/.auto-runtime',
  log_file: '/Users/ada/.auto-runtime/runtime.log',
};

interface FakeRuntime {
  readonly fetch: RuntimeFetch;
  readonly posted: string[];
}

type Behaviour = 'goes down' | 'stays up' | 'comes back' | 'refuses';

function statusAfterAsked(behaviour: Behaviour, status: object): object | undefined {
  if (behaviour === 'goes down') {
    return undefined;
  }
  return behaviour === 'comes back' ? { ...status, started_at: '2026-10-14T09:45:00.000Z' } : status;
}

function fakeRuntime(status: object, behaviour: Behaviour = 'goes down'): FakeRuntime {
  const posted: string[] = [];
  let current: object | undefined = status;
  return {
    posted,
    fetch: (address, { method }) => {
      if (current === undefined) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      if (method !== 'POST') {
        return Promise.resolve(Response.json(current));
      }
      posted.push(address);
      current = statusAfterAsked(behaviour, current);
      return Promise.resolve(Response.json({ status: 'asked' }, { status: behaviour === 'refuses' ? 403 : 202 }));
    },
  };
}

interface Asked {
  readonly asking: RuntimeAsking;
  readonly logged: string[];
  readonly errors: string[];
}

function askingWith(fetch: RuntimeFetch): Asked {
  const logged: string[] = [];
  const errors: string[] = [];
  return {
    logged,
    errors,
    asking: {
      fetch,
      sleep: () => Promise.resolve(),
      console: {
        log: (line) => {
          logged.push(line);
        },
        error: (line) => {
          errors.push(line);
        },
      },
    },
  };
}

describe('the status of the runtime on this computer', () => {
  it('names its release, process, start and directory', async () => {
    const { asking, logged } = askingWith(fakeRuntime(runningInATerminal).fetch);

    await expect(runRuntimeCommand('status', 5555, asking)).resolves.toBe(0);
    expect(logged).toEqual([
      'Auto Runtime 0.9.1 is running at http://localhost:5555',
      '  Process    4242',
      '  Started    2026-10-14 09:41 UTC, in a terminal',
      '  Directory  /Users/ada/playbooks',
    ]);
  });

  it('names its log when an agent started it', async () => {
    const { asking, logged } = askingWith(fakeRuntime(runningForAnAgent).fetch);

    await runRuntimeCommand('status', 5555, asking);

    expect(logged.slice(2)).toEqual([
      '  Started    2026-10-14 09:41 UTC, by your agent',
      '  Directory  /Users/ada/.auto-runtime',
      '  Log        /Users/ada/.auto-runtime/runtime.log',
    ]);
  });
});

describe('stopping the runtime on this computer', () => {
  it('asks it to stop and waits until it has', async () => {
    const runtime = fakeRuntime(runningInATerminal);
    const { asking, logged } = askingWith(runtime.fetch);

    await expect(runRuntimeCommand('stop', 6060, asking)).resolves.toBe(0);
    expect(runtime.posted).toEqual(['http://127.0.0.1:6060/runtime/stop']);
    expect(logged).toEqual(['Auto Runtime has stopped']);
  });

  it('says so when it does not stop', async () => {
    const { asking, errors } = askingWith(fakeRuntime(runningInATerminal, 'stays up').fetch);

    await expect(runRuntimeCommand('stop', 5555, asking)).resolves.toBe(1);
    expect(errors).toEqual(['Auto Runtime on port 5555 did not stop']);
  });

  it('says so when it refuses to', async () => {
    const { asking, errors } = askingWith(fakeRuntime(runningInATerminal, 'refuses').fetch);

    await expect(runRuntimeCommand('stop', 5555, asking)).resolves.toBe(1);
    expect(errors).toEqual(['Auto Runtime on port 5555 did not stop']);
  });
});

describe('restarting the runtime on this computer', () => {
  it('asks it to restart and waits until it started again', async () => {
    const runtime = fakeRuntime(runningInATerminal, 'comes back');
    const { asking, logged } = askingWith(runtime.fetch);

    await expect(runRuntimeCommand('restart', 5555, asking)).resolves.toBe(0);
    expect(runtime.posted).toEqual(['http://127.0.0.1:5555/runtime/restart']);
    expect(logged).toEqual(['Auto Runtime has restarted']);
  });

  it('says so when it does not come back', async () => {
    const { asking, errors } = askingWith(fakeRuntime(runningInATerminal, 'goes down').fetch);

    await expect(runRuntimeCommand('restart', 5555, asking)).resolves.toBe(1);
    expect(errors).toEqual(['Auto Runtime on port 5555 did not come back after it was asked to restart']);
  });
});

const healthyWithoutControls: RuntimeFetch = (address) =>
  Promise.resolve(address.endsWith('/health') ? Response.json({ status: 'ok' }) : Response.json({}, { status: 404 }));

describe('what cannot be controlled from the command line', () => {
  it.each<RuntimeCommand>(['status', 'stop', 'restart'])(
    '%s says no runtime runs when none answers',
    async (command) => {
      const { asking, errors } = askingWith(() => Promise.reject(new TypeError('fetch failed')));

      await expect(runRuntimeCommand(command, 5555, asking)).resolves.toBe(1);
      expect(errors).toEqual(['No Auto Runtime is running on port 5555']);
    },
  );

  it('says a runtime started another way cannot be controlled', async () => {
    const { asking, errors } = askingWith(healthyWithoutControls);

    await expect(runRuntimeCommand('stop', 5555, asking)).resolves.toBe(1);
    expect(errors).toEqual([
      'The Auto Runtime on port 5555 cannot be controlled from here: only one the auto-runtime command started in local mode can',
    ]);
  });

  it('says another program answers on the port', async () => {
    const { asking, errors } = askingWith(() => Promise.resolve(new Response('<html></html>')));

    await expect(runRuntimeCommand('status', 3000, asking)).resolves.toBe(1);
    expect(errors).toEqual(['Another program answers on port 3000, not Auto Runtime']);
  });
});

const guardedRuntime: RuntimeFetch = (address) =>
  Promise.resolve(
    address.endsWith('/health')
      ? Response.json({ status: 'ok' })
      : Response.json({ type: 'https://on.auto/problems/unauthenticated' }, { status: 401 }),
  );

describe('what cannot be controlled from the command line, though it runs', () => {
  it('says a runtime that asks for a credential cannot be controlled', async () => {
    const { asking, errors } = askingWith(guardedRuntime);

    await expect(runRuntimeCommand('restart', 5555, asking)).resolves.toBe(1);
    expect(errors).toEqual([
      'The Auto Runtime on port 5555 asks for a credential, so it cannot be controlled from here: only one the auto-runtime command started in local mode can',
    ]);
  });

  it('says a runtime that does not answer does not', async () => {
    const { asking, errors } = askingWith(() =>
      Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    );

    await expect(runRuntimeCommand('status', 5555, asking)).resolves.toBe(1);
    expect(errors).toEqual(['The Auto Runtime on port 5555 does not answer']);
  });
});

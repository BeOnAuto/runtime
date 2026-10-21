import type { RuntimeControl } from '@on.auto/api';
import { describe, expect, it } from 'vitest';

import {
  localControlOf,
  logFileIn,
  providerSetupFor,
  restartIn,
  restartWordsFor,
  runtimeStatusOf,
  type LocalRun,
  type RestartingProcess,
} from './local-control.ts';
import { runsInFlight } from './runs-in-flight.ts';

const inATerminal: LocalRun = {
  version: '0.9.1',
  pid: 4242,
  instance: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  startedAt: new Date('2026-10-14T09:41:07.000Z'),
  directory: '/Users/ada/playbooks',
  home: '/Users/ada',
  startedBy: 'terminal',
  port: undefined,
};

const noMark = { leave: () => true };

function controlOf(
  run: LocalRun = inATerminal,
  restartMark: { readonly leave: (pid: number) => boolean } = noMark,
): { readonly control: RuntimeControl; readonly asked: Promise<unknown> } {
  const local = localControlOf(run, runsInFlight(), restartMark);
  const { runtimeControl } = local.servingIn('local');
  if (runtimeControl === undefined) {
    throw new Error('a runtime in local mode has no control');
  }
  return { control: runtimeControl, asked: local.asked };
}

describe('the status of a runtime the auto-runtime command started', () => {
  it('names no log when it writes to the terminal it started in', () => {
    expect(runtimeStatusOf(inATerminal, 0)).toEqual({
      version: '0.9.1',
      pid: 4242,
      instance: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      startedAt: new Date('2026-10-14T09:41:07.000Z'),
      directory: '/Users/ada/playbooks',
      startedBy: 'terminal',
      logFile: undefined,
      runsInFlight: 0,
    });
  });

  it('names the log in the home of the runtime when an agent started it', () => {
    expect(runtimeStatusOf({ ...inATerminal, startedBy: 'agent' }, 0).logFile).toBe(
      '/Users/ada/.auto-runtime/runtime.log',
    );
    expect(logFileIn('/Users/ada')).toBe('/Users/ada/.auto-runtime/runtime.log');
  });
});

describe('asking a runtime to stop or restart', () => {
  it('says what was asked first', async () => {
    const { control, asked } = controlOf();

    control.restart();
    control.stop();

    await expect(asked).resolves.toBe('restart');
  });

  it('leaves the mark of its process before it restarts, and none when it stops', async () => {
    const left: number[] = [];
    const recording = {
      leave: (pid: number) => {
        left.push(pid);
        return true;
      },
    };
    const toRestart = controlOf(inATerminal, recording);
    const toStop = controlOf(inATerminal, { leave: () => false });

    toRestart.control.restart();
    toStop.control.stop();

    await expect(Promise.all([toRestart.asked, toStop.asked])).resolves.toEqual(['restart', 'stop']);
    expect(left).toEqual([4242]);
  });

  it('says it was asked to stop', async () => {
    const { control, asked } = controlOf();

    control.stop();

    await expect(asked).resolves.toBe('stop');
  });

  it('reports the status of the run it was given', () => {
    expect(controlOf().control.status()).toEqual(runtimeStatusOf(inATerminal, 0));
  });
});

describe('what a runtime the auto-runtime command started serves in each access mode', () => {
  it('is controlled in local mode, counts its runs in flight and names the restart in its provider setup', () => {
    const runs = runsInFlight();

    const serving = localControlOf(inATerminal, runs, noMark).servingIn('local');

    expect(serving).toMatchObject({
      appended: runs,
      providerSetup: providerSetupFor('/Users/ada/playbooks', restartWordsFor(inATerminal)),
    });
    expect(serving.runtimeControl?.status()).toMatchObject({ runsInFlight: 0 });
  });

  it.each(['credentials', 'closed'] as const)('is not controlled in %s mode, and names no restart command', (mode) => {
    expect(localControlOf(inATerminal, runsInFlight(), noMark).servingIn(mode)).toEqual({
      providerSetup: providerSetupFor('/Users/ada/playbooks'),
    });
  });
});

interface Executed {
  readonly file: string;
  readonly args: readonly string[] | undefined;
  readonly env: Readonly<NodeJS.ProcessEnv> | undefined;
}

interface Restarting {
  readonly running: RestartingProcess;
  readonly executed: readonly Executed[];
  readonly said: readonly string[];
}

function restarting(): Restarting {
  const executed: Executed[] = [];
  const said: string[] = [];
  return {
    executed,
    said,
    running: {
      execPath: '/usr/local/bin/node',
      execArgv: ['--max-old-space-size=4096'],
      argv: ['/usr/local/bin/node', '/cache/packages/server/auto-runtime.ts', 'start'],
      execve: (file, args, env): never => {
        executed.push({ file, args, env });
        throw new Error('replaced');
      },
      stderr: {
        write: (text) => {
          said.push(text);
        },
      },
    },
  };
}

describe('restarting the process of the runtime', () => {
  it('runs the same command again in its place, with the environment it first had', () => {
    const { running, executed } = restarting();

    expect(() => {
      restartIn(running, { PATH: '/usr/bin' });
    }).toThrow('replaced');
    expect(executed).toEqual([
      {
        file: '/usr/local/bin/node',
        args: ['/usr/local/bin/node', '--max-old-space-size=4096', '/cache/packages/server/auto-runtime.ts', 'start'],
        env: { PATH: '/usr/bin' },
      },
    ]);
  });

  it('says it stopped instead where a process cannot replace itself', () => {
    const { running, said } = restarting();

    restartIn({ ...running, execve: undefined }, {});

    expect(said).toEqual(['Auto Runtime restarts only on macOS and Linux, so it has stopped instead\n']);
  });
});

describe('what a runtime on this computer tells an agent about adding a model provider', () => {
  it('names the .env it reads, how to restart it, and the first function after', () => {
    expect(providerSetupFor('/Users/ada/.auto-runtime', restartWordsFor(inATerminal))).toBe(
      'To add one, ask the person to put a line such as ANTHROPIC_API_KEY=<their key> in /Users/ada/.auto-runtime/.env, never in this chat, then restart Auto Runtime with npx -y @on.auto/runtime@0.9.1 restart or at http://localhost:5555. Then offer a first function, as the first-playbook recipe of get_guide does; on.auto/docs has more.',
    );
  });

  it('names its port where it runs on another one', () => {
    expect(providerSetupFor('/Users/ada/playbooks', restartWordsFor({ ...inATerminal, port: '6060' }))).toContain(
      'then restart Auto Runtime with PORT=6060 npx -y @on.auto/runtime@0.9.1 restart or at http://localhost:6060.',
    );
  });

  it('only asks for a restart where the auto-runtime command cannot restart it', () => {
    expect(providerSetupFor('/Users/ada/playbooks')).toContain(
      'in /Users/ada/playbooks/.env, never in this chat, then restart Auto Runtime. Then offer a first function',
    );
  });
});

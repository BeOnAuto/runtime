import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RuntimeControl } from '@on.auto/api';
import { describe, expect, it } from 'vitest';

import { homeOfTheTest } from '../testing/processes/runtime-command.ts';
import {
  localControlOf,
  logFileIn,
  providerSetupFor,
  restartIn,
  restartMarkIn,
  restartWordsFor,
  runtimeStatusOf,
  type LocalRun,
  type RestartingProcess,
} from './local-control.ts';
import { runsInFlight } from './runs-in-flight.ts';
import { restartWaitMs } from './runtime-probe.ts';

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
  restartMark: { readonly leave: (pid: number, port: number) => boolean } = noMark,
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

  it('leaves the mark of its process and of the port it serves before it restarts, and none when it stops', async () => {
    const left: { readonly pid: number; readonly port: number }[] = [];
    const recording = {
      leave: (pid: number, port: number) => {
        left.push({ pid, port });
        return true;
      },
    };
    const onTheDefaultPort = controlOf(inATerminal, recording);
    const onAnotherPort = controlOf({ ...inATerminal, port: '6060' }, recording);
    const toStop = controlOf(inATerminal, { leave: () => false });

    onTheDefaultPort.control.restart();
    onAnotherPort.control.restart();
    toStop.control.stop();

    await expect(Promise.all([onTheDefaultPort.asked, onAnotherPort.asked, toStop.asked])).resolves.toEqual([
      'restart',
      'restart',
      'stop',
    ]);
    expect(left).toEqual([
      { pid: 4242, port: 5555 },
      { pid: 4242, port: 6060 },
    ]);
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

const homePrefix = 'auto-runtime-mark-';

const port = 5555;

const anotherPort = 19_700;

function markFileIn(home: string): string {
  return join(home, '.auto-runtime', 'restart-mark.json');
}

function goneProcess(): number {
  return spawnSync(process.execPath, ['-e', '']).pid;
}

describe('the mark a runtime leaves while it restarts', () => {
  it('says a restart is under way on its port while the process that left it runs, within the restart wait', () => {
    const home = homeOfTheTest(homePrefix);
    const at = Date.now();
    const mark = restartMarkIn(home, () => at);

    expect(mark.leave(process.pid, port)).toBe(true);
    const left: unknown = JSON.parse(readFileSync(markFileIn(home), 'utf8'));
    expect(left).toEqual({ pid: process.pid, at, port });
    expect(mark.isUnderWay(port)).toBe(true);
  });

  it('says no restart is under way on another port, whose relay has no restart to wait through', () => {
    const mark = restartMarkIn(homeOfTheTest(homePrefix));

    mark.leave(process.pid, anotherPort);

    expect([mark.isUnderWay(port), mark.isUnderWay(anotherPort)]).toEqual([false, true]);
  });

  it('is stale once its process is gone, or once it is older than the restart wait', () => {
    const home = homeOfTheTest(homePrefix);
    restartMarkIn(home).leave(goneProcess(), port);
    const gone = restartMarkIn(home).isUnderWay(port);
    restartMarkIn(home, () => Date.now() - restartWaitMs - 1).leave(process.pid, port);

    expect([gone, restartMarkIn(home).isUnderWay(port)]).toEqual([false, false]);
  });
});

describe('what is no mark of a restart', () => {
  it('is no file, a file that is not a mark, or a mark that names no port', () => {
    const home = homeOfTheTest(homePrefix);
    const mark = restartMarkIn(home);
    const without = mark.isUnderWay(port);
    mkdirSync(join(home, '.auto-runtime'));
    writeFileSync(markFileIn(home), 'restarting');
    const notAMark = mark.isUnderWay(port);
    writeFileSync(markFileIn(home), JSON.stringify({ pid: process.pid, at: Date.now() }));

    expect([without, notAMark, mark.isUnderWay(port)]).toEqual([false, false, false]);
  });
});

describe('the end of the mark a runtime leaves while it restarts', () => {
  it('is cleared by the process that left it, once it answers again, and by no other', () => {
    const home = homeOfTheTest(homePrefix);
    const mark = restartMarkIn(home);
    mark.leave(process.pid, port);

    mark.clear(process.pid + 1);
    const keptForAnother = existsSync(markFileIn(home));
    mark.clear(process.pid);

    expect([keptForAnother, existsSync(markFileIn(home))]).toEqual([true, false]);
  });

  it('is not left where it cannot be written', () => {
    const home = homeOfTheTest(homePrefix);
    mkdirSync(join(home, '.auto-runtime'));
    chmodSync(join(home, '.auto-runtime'), 0o500);

    expect(restartMarkIn(home).leave(process.pid, port)).toBe(false);
  });
});

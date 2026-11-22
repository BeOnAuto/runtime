import { describe, expect, it, onTestFinished } from 'vitest';

import { startChild, type ChildCommand, type RunningChild, type SpawnChild } from './children.ts';

function shell(script: string): ChildCommand {
  return {
    command: '/bin/sh',
    args: ['-c', script],
    environment: {},
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'inherit',
  };
}

function started(command: ChildCommand): RunningChild {
  const child = startChild(command);
  onTestFinished(async () => {
    await child.stop('SIGKILL');
  });
  return child;
}

interface FakeChild {
  readonly spawn: SpawnChild;
  readonly signalled: () => readonly NodeJS.Signals[];
}

function fakeChild(): FakeChild {
  const signalled: NodeJS.Signals[] = [];
  const { promise: ended, resolve: end } = Promise.withResolvers<string>();
  const child = {
    pid: 4321,
    ended,
    kill: (name: NodeJS.Signals) => {
      signalled.push(name);
      end(`signal ${name}`);
      return true;
    },
  };
  return { spawn: () => child, signalled: () => [...signalled] };
}

/*
 * Three spawns, each showing what only node's spawn does: an exit code and what the child wrote, a signal, and a
 * program that is not there. The rest is the runner's handle of a child, on a fake.
 */
describe('a child of the dev runner', () => {
  it('passes on what it writes to stdout, and says how it ended when it exits', async () => {
    const { promise: written, resolve: write } = Promise.withResolvers<string>();
    const child = started({ ...shell('echo started; exit 3'), stdout: write });

    await expect(written).resolves.toBe('started\n');
    await expect(child.ended).resolves.toBe('exit code 3');
  });

  it('says which signal ended it, once the stop that signalled it has ended it', async () => {
    const child = started(shell('exec sleep 30'));

    await expect(child.stop('SIGTERM')).resolves.toBe('signal SIGTERM');
    await expect(child.ended).resolves.toBe('signal SIGTERM');
  });

  it('says why it could not start, and a stop of it ends at once', async () => {
    const child = started({ ...shell(''), command: '/nonexistent/program' });

    await expect(child.ended).resolves.toBe('Error: spawn /nonexistent/program ENOENT');
    await expect(child.stop('SIGTERM')).resolves.toBe('Error: spawn /nonexistent/program ENOENT');
  });
});

describe('stopping a child of the dev runner', () => {
  it('signals the child it started through its handle, and nothing else, then says how it ended', async () => {
    const fake = fakeChild();
    const child = startChild(shell('sleep 30'), fake.spawn);

    const ended = await child.stop('SIGTERM');

    expect({ ended, signalled: fake.signalled() }).toEqual({ ended: 'signal SIGTERM', signalled: ['SIGTERM'] });
  });
});

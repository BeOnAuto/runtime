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

describe('a child of the dev runner', () => {
  it('says how it ended when it exits', async () => {
    await expect(started(shell('exit 3')).ended).resolves.toBe('exit code 3');
  });

  it('says which signal ended it', async () => {
    const child = started(shell('sleep 30'));

    child.signal('SIGTERM');

    await expect(child.ended).resolves.toBe('signal SIGTERM');
  });

  it('says why it could not start', async () => {
    const child = started({ ...shell(''), command: '/nonexistent/program' });

    await expect(child.ended).resolves.toBe('Error: spawn /nonexistent/program ENOENT');
  });

  it('passes on what it writes to stdout', async () => {
    const { promise: written, resolve: write } = Promise.withResolvers<string>();
    started({ ...shell('echo started; exec sleep 30'), stdout: write });

    await expect(written).resolves.toBe('started\n');
  });
});

describe('stopping a child of the dev runner', () => {
  it('signals the child it started through its handle, and nothing else, then says how it ended', async () => {
    const fake = fakeChild();
    const child = startChild(shell('sleep 30'), fake.spawn);

    const ended = await child.stop('SIGTERM');

    expect({ ended, signalled: fake.signalled() }).toEqual({ ended: 'signal SIGTERM', signalled: ['SIGTERM'] });
  });

  it('ends once the child it signalled has ended', async () => {
    const child = started(shell('sleep 30'));

    await expect(child.stop('SIGTERM')).resolves.toBe('signal SIGTERM');
  });

  it('ends at once when the child could not start', async () => {
    const child = started({ ...shell(''), command: '/nonexistent/program' });

    await expect(child.stop('SIGTERM')).resolves.toBe('Error: spawn /nonexistent/program ENOENT');
  });
});

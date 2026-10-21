import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startWaitMs } from '../local-runtime/runtime-probe.ts';
import { noticesFor, startingLockIn } from './background-process.ts';

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'auto-runtime-background-')));
});

afterEach(() => {
  chmodSync(home, 0o700);
  rmSync(home, { recursive: true, force: true });
});

function lockFile(): string {
  return join(home, '.auto-runtime', 'starting.lock');
}

function takenOverByAnother(): number {
  renameSync(lockFile(), `${lockFile()}.another`);
  return Date.now();
}

function leftAt(time: Readonly<Date>): void {
  mkdirSync(join(home, '.auto-runtime'), { recursive: true });
  writeFileSync(lockFile(), '');
  utimesSync(lockFile(), time, time);
}

describe('the lock that one agent holds while it starts the runtime', () => {
  it('is held by one at a time', () => {
    const lock = startingLockIn(home, () => Date.now());

    expect([lock.take(), lock.take()]).toEqual([true, false]);
    lock.release();
    expect(lock.take()).toBe(true);
  });

  it('is taken over, once, when whoever took it left it for longer than a start can take', () => {
    const lock = startingLockIn(home, () => Date.now());
    const left = new Date(Date.now() - 3 * startWaitMs);
    leftAt(left);

    expect([lock.take(), lock.take()]).toEqual([true, false]);
    expect(statSync(lockFile()).mtimeMs).toBeGreaterThan(left.getTime());
    expect(readdirSync(join(home, '.auto-runtime'))).toEqual(['starting.lock']);
  });

  it('is left to whoever took it while it is younger than a start can take', () => {
    leftAt(new Date(Date.now() - startWaitMs));

    expect(startingLockIn(home, () => Date.now()).take()).toBe(false);
  });

  it('cannot be taken where it cannot be written', () => {
    mkdirSync(join(home, '.auto-runtime'));
    chmodSync(join(home, '.auto-runtime'), 0o500);

    expect(startingLockIn(home, () => Date.now()).take()).toBe(false);
    chmodSync(join(home, '.auto-runtime'), 0o700);
  });
});

describe('the lock that two agents take over at once', () => {
  it('is left to another agent whose takeover came first, between the look at it and the takeover', () => {
    leftAt(new Date(Date.now() - 3 * startWaitMs));

    expect(startingLockIn(home, takenOverByAnother).take()).toBe(false);
  });

  it('is given back to another agent that took it over between the look at it and the takeover', () => {
    const left = new Date(Date.now() - 3 * startWaitMs);
    leftAt(left);
    const looks = [Date.now(), left.getTime()];

    expect(startingLockIn(home, () => Number(looks.shift())).take()).toBe(false);
    expect(readdirSync(join(home, '.auto-runtime'))).toEqual(['starting.lock']);
  });
});

describe('the notices of an agent about the runtime', () => {
  it('are said once each, to the agent and in the log of the runtime', () => {
    mkdirSync(join(home, '.auto-runtime'));
    const reported: string[] = [];
    const notice = noticesFor(home, (line) => {
      reported.push(line);
    });

    notice('a newer release waits');
    notice('a newer release waits');

    expect(reported).toEqual(['a newer release waits']);
    expect(readFileSync(join(home, '.auto-runtime', 'runtime.log'), 'utf8')).toBe('a newer release waits\n');
  });

  it('are said to the agent alone, with why, where the log cannot be written', () => {
    const reported: string[] = [];

    noticesFor(home, (line) => {
      reported.push(line);
    })('a newer release waits');

    expect(reported).toEqual([
      'a newer release waits',
      `Auto Runtime could not write to ${join(home, '.auto-runtime', 'runtime.log')}`,
    ]);
  });
});

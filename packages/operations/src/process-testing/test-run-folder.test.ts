import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RunningProcess } from './process-endings.ts';
import { spawnForTheTest } from './test-processes.ts';
import theFolderOfTheTestRun, { aFolderOfTheTestRun, type RunningIn } from './test-run-folder.ts';

const run = { name: 'probe' };

function tmpdirOfAProcessItStarts(): string {
  return spawnSync(process.execPath, ['--eval', "process.stdout.write(require('node:os').tmpdir())"], {
    encoding: 'utf8',
  }).stdout;
}

function leftIn(folder: string, ...names: readonly string[]): void {
  for (const name of names) {
    mkdirSync(join(folder, name));
  }
}

describe('the temporary folder of a test run', () => {
  it('is made in the temporary folder it is set up in, named for the run, and is the temporary folder of the run and of what it starts until its teardown removes it', async () => {
    const outside = tmpdir();
    const teardown = theFolderOfTheTestRun(run);
    const folder = tmpdir();
    const ofAProcessItStarts = tmpdirOfAProcessItStarts();

    await teardown();

    expect([dirname(folder), basename(folder).startsWith('auto-runtime-test-run-probe-')]).toEqual([outside, true]);
    expect([ofAProcessItStarts, existsSync(folder), tmpdir()]).toEqual([folder, false, outside]);
  });

  it('fails the run, naming in order what its tests left there, and is removed all the same', async () => {
    const teardown = theFolderOfTheTestRun(run);
    const folder = tmpdir();
    leftIn(folder, 'left-second');
    writeFileSync(join(folder, 'left-first'), '');

    await expect(teardown()).rejects.toThrow(
      new Error('The tests of the run did not remove what they left in its temporary folder: left-first, left-second.'),
    );
    expect(existsSync(folder)).toBe(false);
  });

  it('is its own in each of two runs set up at once, so the teardown of one names nothing the other left', async () => {
    const outside = tmpdir();
    const first = theFolderOfTheTestRun(run);
    const ofTheFirst = tmpdir();
    process.env['TMPDIR'] = outside;
    const second = theFolderOfTheTestRun(run);
    leftIn(ofTheFirst, 'left-by-the-first');

    await second();

    await expect(first()).rejects.toThrow(/: left-by-the-first\.$/u);
  });
});

const stopsWhenTold = [
  "process.on('SIGTERM', () => { process.stdout.write('stopped'); process.exit(0); });",
  'setInterval(() => {}, 1000);',
  "process.stdout.write('ready ');",
].join('\n');

interface Probe {
  readonly ready: Promise<void>;
  readonly printed: () => string;
  readonly closed: Promise<readonly unknown[]>;
  readonly runningIn: RunningIn;
  readonly lookedIn: () => readonly (readonly [string, boolean])[];
}

function aProbeRunningIn(home: string): Probe {
  const child = spawnForTheTest(process.execPath, ['--eval', stopsWhenTold], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const printed = { text: '' };
  const ready = Promise.withResolvers<void>();
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    printed.text += chunk;
    ready.resolve();
  });
  const running: RunningProcess = {
    name: 'a probe',
    pid: Number(child.pid),
    isStillRunning: () => child.exitCode === null && child.signalCode === null,
  };
  const lookedIn: (readonly [string, boolean])[] = [];
  return {
    ready: ready.promise,
    printed: () => printed.text,
    closed: once(child, 'close'),
    runningIn: (entry) => {
      lookedIn.push([basename(entry), existsSync(entry)]);
      return basename(entry) === home ? [running] : [];
    },
    lookedIn: () => lookedIn,
  };
}

describe('a process still running in what the tests of a run left in its folder', () => {
  it('is ended as its teardown looks, before the folder is removed, and named with what it ran in', async () => {
    const probe = aProbeRunningIn('a-home');
    const teardown = aFolderOfTheTestRun(probe.runningIn)(run);
    leftIn(tmpdir(), 'a-home', 'a-folder');
    await probe.ready;

    await expect(teardown()).rejects.toThrow(
      new Error(
        'The tests of the run did not remove what they left in its temporary folder: a-folder, a-home. The teardown ended a probe, which still ran in a-home.',
      ),
    );

    expect(await probe.closed).toEqual([0, null]);
    expect([probe.printed(), probe.lookedIn()]).toEqual([
      'ready stopped',
      [
        ['a-folder', true],
        ['a-home', true],
      ],
    ]);
  });
});

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { measuredEnvironment } from './measured-environment.ts';
import type { PidEnding, RunningProcess } from './process-endings.ts';
import theFolderOfTheTestRun, { aFolderOfTheTestRun, type RunningIn } from './test-run-folder.ts';

describe('the environment a worker or a process of a test is given', () => {
  it('holds the folder the coverage of the run is written to, as the run gives it, and nothing else', () => {
    expect(Object.keys(measuredEnvironment).filter((key) => key !== 'NODE_V8_COVERAGE')).toEqual([]);
    expect(measuredEnvironment['NODE_V8_COVERAGE']).toBe(process.env['NODE_V8_COVERAGE']);
  });
});

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

interface Probe {
  readonly runningIn: RunningIn;
  readonly ending: PidEnding;
  readonly lookedIn: () => readonly (readonly [string, boolean])[];
  readonly sent: () => readonly string[];
}

/** A process known by its pid alone that goes on SIGTERM, on a fake signaller and the fake clock. */
function aProbeRunningIn(home: string): Probe {
  const state = { running: true };
  const sent: string[] = [];
  const pid = 4242;
  const running: RunningProcess = { name: 'a probe', pid, isStillRunning: () => state.running };
  const lookedIn: (readonly [string, boolean])[] = [];
  return {
    runningIn: (entry) => {
      lookedIn.push([basename(entry), existsSync(entry)]);
      return basename(entry) === home ? [running] : [];
    },
    ending: {
      signaller: (to, signal) => {
        sent.push(`${String(signal)} to ${String(to)}`);
        state.running = false;
        return true;
      },
      timer: {
        after: (ms, stop) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            stop.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('stopped'));
            });
          }),
      },
      lookEveryMs: 50,
      stoppedWithinMs: 300,
    },
    lookedIn: () => lookedIn,
    sent: () => sent,
  };
}

describe('a process still running in what the tests of a run left in its folder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is ended as its teardown looks, before the folder is removed, and named with what it ran in', async () => {
    const probe = aProbeRunningIn('a-home');
    const teardown = aFolderOfTheTestRun(probe.runningIn, probe.ending)(run);
    leftIn(tmpdir(), 'a-home', 'a-folder');

    await expect(teardown()).rejects.toThrow(
      new Error(
        'The tests of the run did not remove what they left in its temporary folder: a-folder, a-home. The teardown ended a probe, which still ran in a-home.',
      ),
    );

    expect([probe.sent(), probe.lookedIn()]).toEqual([
      ['SIGTERM to 4242'],
      [
        ['a-folder', true],
        ['a-home', true],
      ],
    ]);
  });
});

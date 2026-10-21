import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultServerOptions } from '../lifecycle/lifecycle.ts';
import { longestStopMs } from '../lifecycle/shutdown.ts';
import { probeEveryMs } from './runtime-probe.ts';
import { restartMarkIn, restartWaitMs, startWaitMs, throughARestart } from './runtime-restarts.ts';

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'auto-runtime-background-')));
});

afterEach(() => {
  chmodSync(home, 0o700);
  rmSync(home, { recursive: true, force: true });
});

const markFile = (): string => join(home, '.auto-runtime', 'restart-mark.json');

const goneProcess = (): number => spawnSync(process.execPath, ['-e', '']).pid;

describe('the mark a runtime leaves while it restarts', () => {
  it('says a restart is under way while the process that left it runs, within the restart wait', () => {
    const at = Date.now();
    const mark = restartMarkIn(home, () => at);

    expect(mark.leave(process.pid)).toBe(true);
    const left: unknown = JSON.parse(readFileSync(markFile(), 'utf8'));
    expect(left).toEqual({ pid: process.pid, at });
    expect(mark.isUnderWay()).toBe(true);
  });

  it('is stale once its process is gone, or once it is older than the restart wait', () => {
    restartMarkIn(home).leave(goneProcess());
    const gone = restartMarkIn(home).isUnderWay();
    restartMarkIn(home, () => Date.now() - restartWaitMs - 1).leave(process.pid);

    expect([gone, restartMarkIn(home).isUnderWay()]).toEqual([false, false]);
  });

  it('says no restart is under way where there is no mark, or one that is not a mark', () => {
    const mark = restartMarkIn(home);
    const without = mark.isUnderWay();
    mkdirSync(join(home, '.auto-runtime'));
    writeFileSync(markFile(), 'restarting');

    expect([without, mark.isUnderWay()]).toEqual([false, false]);
  });

  it('is cleared by the process that left it, once it answers again, and by no other', () => {
    const mark = restartMarkIn(home);
    mark.leave(process.pid);

    mark.clear(process.pid + 1);
    const keptForAnother = existsSync(markFile());
    mark.clear(process.pid);

    expect([keptForAnother, existsSync(markFile())]).toEqual([true, false]);
  });

  it('is not left where it cannot be written', () => {
    mkdirSync(join(home, '.auto-runtime'));
    chmodSync(join(home, '.auto-runtime'), 0o500);

    expect(restartMarkIn(home).leave(process.pid)).toBe(false);
  });
});

describe('the patience of an agent for a runtime that restarts', () => {
  it('lasts as long as the runtime takes to stop, by the bounds of its shutdown, and then to start', () => {
    const { shutdownTimeoutMs, exitDeadlineMs } = defaultServerOptions;

    expect(throughARestart.attempts * probeEveryMs).toBe(restartWaitMs);
    expect(restartWaitMs).toBe(longestStopMs + startWaitMs);
    expect(longestStopMs).toBeGreaterThan(shutdownTimeoutMs + exitDeadlineMs);
  });
});

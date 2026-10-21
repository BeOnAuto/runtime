import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { endWithTheTest } from '@on.auto/operations/testing';
import { Function } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { until } from '../testing/waiting/until.ts';
import { startInBackgroundOf } from './background-process.ts';

const recordingEntry = fileURLToPath(new URL('../testing/entries/record-background-start.ts', import.meta.url));

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'auto-runtime-background-')));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const stayingEntry = fileURLToPath(new URL('../testing/entries/stay-until-signalled.ts', import.meta.url));

const testEnvironment = { PATH: process.env['PATH'], NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] };

const anInstance = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/u;

describe('starting the runtime in the background', () => {
  it('starts it from the home of the runtime, writing to its log, as the instance it hands back', async () => {
    const logged: string[] = [];
    const started = startInBackgroundOf({
      execPath: process.execPath,
      execArgv: [],
      entry: recordingEntry,
      home,
      environment: testEnvironment,
      report: Function.constVoid,
      log: (line) => {
        logged.push(line);
      },
    })();
    await started.ended;

    const runtimeHome = join(home, '.auto-runtime');
    expect(started.instance).toMatch(anInstance);
    expect(JSON.parse(readFileSync(join(runtimeHome, 'started.json'), 'utf8'))).toEqual({
      arguments: ['start', '--background', '--instance', started.instance],
      directory: runtimeHome,
    });
    await until(() => {
      expect(readFileSync(join(runtimeHome, 'runtime.log'), 'utf8')).toBe('started in the background\n');
    });
    expect(logged).toEqual([
      `Auto Runtime was started in the background as process ${String(started.pid)}, instance ${started.instance}`,
      `Auto Runtime, process ${String(started.pid)}, ended`,
    ]);
    expect(started.endedAt()).toBeGreaterThanOrEqual(started.startedAt);
    expect(started.signal('SIGTERM')).toBe(false);
  });
});

describe('the handle of a runtime started in the background', () => {
  it('signals the runtime it started while it runs, and knows when it ended', async () => {
    const started = startInBackgroundOf({
      execPath: process.execPath,
      execArgv: [],
      entry: stayingEntry,
      home,
      environment: testEnvironment,
      report: Function.constVoid,
      log: Function.constVoid,
    })();
    endWithTheTest(Number(started.pid));
    await until(() => {
      expect(existsSync(join(home, '.auto-runtime', 'started.json'))).toBe(true);
    });

    const living = started.endedAt();
    const signalled = started.signal('SIGTERM');
    await started.ended;

    expect([living, signalled]).toEqual([undefined, true]);
    expect(started.endedAt()).toBeGreaterThanOrEqual(started.startedAt);
  });
});

describe('a runtime that could not be started in the background', () => {
  it('is reported, and counted as ended', async () => {
    const reported: string[] = [];
    const logged: string[] = [];

    const started = startInBackgroundOf({
      execPath: join(home, 'no-node-here'),
      execArgv: [],
      entry: recordingEntry,
      home,
      environment: {},
      report: (line) => {
        reported.push(line);
      },
      log: (line) => {
        logged.push(line);
      },
    })();
    await started.ended;

    expect(reported).toEqual([expect.stringMatching(/^Auto Runtime could not be started: spawn .*ENOENT$/u)]);
    expect(started.pid).toBeUndefined();
    expect(logged.filter((line) => line.includes('was started'))).toEqual([]);
  });
});

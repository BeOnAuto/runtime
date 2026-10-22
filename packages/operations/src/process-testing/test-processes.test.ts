import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { describe, expect, it, onTestFinished } from 'vitest';

import { stoppedWithinMs } from './process-endings.ts';
import { endWithTheTest, spawnForTheTest, type PidReader, type TestFinish } from './test-processes.ts';

const stopsWhenTold = [
  "process.on('SIGTERM', () => { process.stdout.write('stopped'); process.exit(0); });",
  'setInterval(() => {}, 1000);',
  "process.stdout.write('ready ');",
].join('\n');

const holdsOnWhenTold = [
  "process.on('SIGTERM', () => { process.stdout.write('held on'); });",
  'setInterval(() => {}, 1000);',
  "process.stdout.write('ready ');",
].join('\n');

interface Finished {
  readonly finish: TestFinish;
  readonly finished: () => Promise<void>;
}

interface Started {
  readonly pid: number;
  readonly ready: Promise<void>;
  readonly output: () => string;
  readonly closed: Promise<readonly unknown[]>;
  readonly signalled: () => boolean;
}

function collectedWithin(withinMs: number): Finished {
  const ends: (() => Promise<void>)[] = [];
  return {
    finish: {
      registered: (end) => {
        ends.push(end);
      },
      stoppedWithinMs: withinMs,
    },
    finished: async () => {
      await Promise.all(ends.map((end) => end()));
    },
  };
}

function finishedWithin(withinMs: number): Finished {
  const collected = collectedWithin(withinMs);
  return {
    finish: {
      ...collected.finish,
      registered: (end) => {
        collected.finish.registered(end);
        onTestFinished(end);
      },
    },
    finished: collected.finished,
  };
}

interface Reading {
  readonly answer?: { readonly pid: number; readonly fromRead: number };
  readonly stillToCome: boolean;
  readonly readWithinMs: number;
}

interface Counted {
  readonly reader: PidReader;
  readonly reads: () => number;
}

function counted({ answer, stillToCome, readWithinMs }: Reading): Counted {
  const reads = { count: 0 };
  const answerAt = (read: number): number | undefined =>
    answer !== undefined && read >= answer.fromRead ? answer.pid : undefined;
  return {
    reader: {
      read: () => {
        reads.count += 1;
        return Promise.resolve(answerAt(reads.count));
      },
      stillToCome: () => stillToCome,
      readWithinMs,
    },
    reads: () => reads.count,
  };
}

function started(script: string, finish?: TestFinish): Started {
  const child = spawnForTheTest(
    process.execPath,
    ['--eval', script],
    { env: {}, stdio: ['ignore', 'pipe', 'inherit'] },
    finish,
  );
  const printed = { text: '' };
  const { promise: ready, resolve } = Promise.withResolvers<void>();
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    printed.text += chunk;
    if (printed.text.startsWith('ready')) {
      resolve();
    }
  });
  return {
    pid: Number(child.pid),
    ready,
    output: () => printed.text,
    closed: once(child, 'close'),
    signalled: () => child.killed,
  };
}

describe('a process started for a test that still runs when the test finishes', () => {
  it('is stopped with SIGTERM, the signal a server stops on', async () => {
    const { finish, finished } = finishedWithin(stoppedWithinMs);
    const running = started(stopsWhenTold, finish);
    await running.ready;

    await finished();

    expect(await running.closed).toEqual([0, null]);
    expect(running.output()).toBe('ready stopped');
  });

  it('is killed once the bound has passed if it is still there, no sooner', async () => {
    const { finish, finished } = finishedWithin(300);
    const running = started(holdsOnWhenTold, finish);
    await running.ready;
    const signalled = performance.now();

    await finished();

    expect(await running.closed).toEqual([null, 'SIGKILL']);
    expect(performance.now() - signalled).toBeGreaterThanOrEqual(300);
    expect(running.output()).toBe('ready held on');
  });
});

describe('a process started for a test that is gone when the test finishes', () => {
  it('is sent no signal when it ended of itself', async () => {
    const { finish, finished } = finishedWithin(stoppedWithinMs);
    const running = started('', finish);
    const closed = await running.closed;

    await finished();

    expect([closed, running.signalled()]).toEqual([[0, null], false]);
  });

  it('is sent no signal when it never started', async () => {
    const left: { killed?: () => boolean } = {};
    onTestFinished(() => {
      expect(left.killed?.()).toBe(false);
    });

    const child = spawnForTheTest(join(tmpdir(), 'no-such-command'), []);
    left.killed = () => child.killed;
    const failed: readonly unknown[] = await once(child, 'error');

    expect([failed[0], child.pid]).toMatchObject([{ code: 'ENOENT' }, undefined]);
  });
});

describe('a process a test did not start itself', () => {
  it('is ended by its pid when the test finishes, as a server started in the background is', async () => {
    const own = finishedWithin(stoppedWithinMs);
    const byItsPid = finishedWithin(stoppedWithinMs);
    const running = started(stopsWhenTold, own.finish);
    await running.ready;
    endWithTheTest(running.pid, byItsPid.finish);

    await byItsPid.finished();

    expect(await running.closed).toEqual([0, null]);
    expect(running.output()).toBe('ready stopped');
  });

  it.each([
    ['at once', 1],
    ['again while its pid is still to come, and ended once it is read', 3],
  ])('is read %s', async (_how, fromRead) => {
    const own = finishedWithin(stoppedWithinMs);
    const byItsReader = finishedWithin(stoppedWithinMs);
    const running = started(stopsWhenTold, own.finish);
    await running.ready;
    const reading = counted({ answer: { pid: running.pid, fromRead }, stillToCome: true, readWithinMs: 10_000 });
    endWithTheTest(reading.reader, byItsReader.finish);

    await byItsReader.finished();

    expect(await running.closed).toEqual([0, null]);
    expect([reading.reads(), running.output()]).toEqual([fromRead, 'ready stopped']);
  });
});

describe('a process whose pid its reader never reads', () => {
  it('is read once when none is still to come', async () => {
    const { finish, finished } = collectedWithin(stoppedWithinMs);
    const reading = counted({ stillToCome: false, readWithinMs: 10_000 });
    endWithTheTest(reading.reader, finish);

    await finished();

    expect(reading.reads()).toBe(1);
  });

  it('is read for no longer than the bound of its reader while one is still to come', async () => {
    const { finish, finished } = collectedWithin(stoppedWithinMs);
    const reading = counted({ stillToCome: true, readWithinMs: 300 });
    endWithTheTest(reading.reader, finish);
    const finishing = performance.now();

    await finished();

    expect(performance.now() - finishing).toBeGreaterThanOrEqual(300);
    expect(reading.reads()).toBeGreaterThan(1);
  });
});

describe('the end of a process at the finish of its test', () => {
  it('is registered with the test runner unless it is given a finish of its own', async () => {
    const ending: Started[] = [];
    const collected = collectedWithin(stoppedWithinMs);
    onTestFinished(async () => {
      try {
        const settled = await Promise.all(
          ending.map(({ closed }) => Promise.race([closed, setTimeout(stoppedWithinMs, 'still running')])),
        );
        expect(settled).toEqual([
          [0, null],
          [0, null],
        ]);
        expect(ending.map(({ output }) => output())).toEqual(['ready stopped', 'ready stopped']);
      } finally {
        await collected.finished();
      }
    });

    const byTheChild = started(stopsWhenTold);
    const byItsPid = started(stopsWhenTold, collected.finish);
    ending.push(byTheChild, byItsPid);
    await Promise.all([byTheChild.ready, byItsPid.ready]);
    endWithTheTest(byItsPid.pid);

    expect(ending.map(({ output }) => output())).toEqual(['ready ', 'ready ']);
  });
});

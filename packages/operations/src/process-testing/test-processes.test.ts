import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { endedWhileItRuns, endedWithin, realTimer, signalled, stoppedWithinMs, type Timer } from './process-endings.ts';
import { aFakeChild, boundMs, collected, counted, fakeProcesses, followed, lookEveryMs } from './process-fakes.ts';
import { endingOfChild, endWithTheTest, spawnForTheTest } from './test-processes.ts';

/** The timer of the fake clock: a promise its `setTimeout` settles, which the fake timers of the test replace. */
const fakeTimer: Timer = {
  after: (ms, stop) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      stop.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('stopped'));
        },
        { once: true },
      );
    }),
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a process known by its pid alone, at the finish of its test', () => {
  it.each([
    ['at once', 0, lookEveryMs],
    ['part way through the bound', 120, 150],
  ])(
    'is sent SIGTERM and found gone at the first look after it went, when it goes %s',
    async (_when, goesAfterMs, foundAtMs) => {
      const processes = fakeProcesses();
      const pid = processes.started({ obeys: 'SIGTERM', goesAfterMs });
      const { finish, finished } = collected(processes.signaller, fakeTimer);
      endWithTheTest(pid, finish);

      const ended = followed(finished());
      await vi.advanceTimersByTimeAsync(foundAtMs - 1);
      const before = ended();
      await vi.advanceTimersByTimeAsync(1);

      expect([before, ended(), processes.sent()]).toEqual([false, true, ['SIGTERM']]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('is sent SIGKILL once the bound has passed if it is still there, no sooner, and found gone after', async () => {
    const processes = fakeProcesses();
    const pid = processes.started({ obeys: 'SIGKILL', goesAfterMs: 10 });
    const { finish, finished } = collected(processes.signaller, fakeTimer);
    endWithTheTest(pid, finish);

    const ended = followed(finished());
    await vi.advanceTimersByTimeAsync(boundMs - 1);
    const beforeTheBound = [...processes.sent()];
    await vi.advanceTimersByTimeAsync(1);
    const atTheBound = [...processes.sent()];
    await vi.advanceTimersByTimeAsync(lookEveryMs);

    expect([beforeTheBound, atTheBound, ended()]).toEqual([['SIGTERM'], ['SIGTERM', 'SIGKILL'], true]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is sent no signal when it is already gone', async () => {
    const processes = fakeProcesses();
    const { finish, finished } = collected(processes.signaller, fakeTimer);
    endWithTheTest(4242, finish);

    await finished();

    expect(processes.sent()).toEqual([]);
  });
});

describe('a process whose pid is read once its test finished', () => {
  it.each([
    ['at once', 1],
    ['again, every look, while it is still to come, and ended once it is read', 3],
  ])('is read %s', async (_how, fromRead) => {
    const processes = fakeProcesses();
    const pid = processes.started({ obeys: 'SIGTERM', goesAfterMs: 0 });
    const reading = counted({ answer: { pid, fromRead }, stillToCome: true });
    const { finish, finished } = collected(processes.signaller, fakeTimer);
    endWithTheTest(reading.reader, finish);

    const ended = followed(finished());
    await vi.advanceTimersByTimeAsync((fromRead - 1) * lookEveryMs + lookEveryMs);

    expect([ended(), reading.reads(), processes.sent()]).toEqual([true, fromRead, ['SIGTERM']]);
  });

  it('is read once when none is still to come, and nothing is signalled', async () => {
    const processes = fakeProcesses();
    const reading = counted({ stillToCome: false });
    const { finish, finished } = collected(processes.signaller, fakeTimer);
    endWithTheTest(reading.reader, finish);

    await finished();

    expect([reading.reads(), processes.sent()]).toEqual([1, []]);
  });

  it('is read every look for no longer than the bound of its reader while one is still to come', async () => {
    const processes = fakeProcesses();
    const reading = counted({ stillToCome: true });
    const { finish, finished } = collected(processes.signaller, fakeTimer);
    endWithTheTest(reading.reader, finish);

    const ended = followed(finished());
    await vi.advanceTimersByTimeAsync(boundMs - 1);
    const before = ended();
    await vi.advanceTimersByTimeAsync(1);

    expect([before, ended(), reading.reads(), processes.sent()]).toEqual([false, true, boundMs / lookEveryMs + 1, []]);
  });
});

describe('a running process a teardown found, at the end of the run', () => {
  it.each([
    ['goes on SIGTERM', 'SIGTERM', ['SIGTERM']],
    ['is killed at the bound', 'SIGKILL', ['SIGTERM', 'SIGKILL']],
  ] as const)('%s, signalled only while it still runs', async (_how, obeys, sent) => {
    const processes = fakeProcesses();
    const pid = processes.started({ obeys, goesAfterMs: 0 });
    const running = { name: 'a probe', pid, isStillRunning: () => processes.signaller(pid, 0) };

    const ended = followed(
      endedWhileItRuns(running, {
        signaller: processes.signaller,
        timer: fakeTimer,
        lookEveryMs,
        stoppedWithinMs: boundMs,
      }),
    );
    await vi.advanceTimersByTimeAsync(boundMs + lookEveryMs);

    expect([ended(), processes.sent()]).toEqual([true, sent]);
  });
});

describe('a child a test started, at the finish of the test', () => {
  it('is found gone on its own exit, without looking, once it goes on SIGTERM', async () => {
    const { child, sent } = aFakeChild(77, 'SIGTERM');

    const ended = followed(endedWithin(endingOfChild(child), boundMs, fakeTimer));
    await vi.advanceTimersByTimeAsync(9);
    const before = ended();
    await vi.advanceTimersByTimeAsync(1);

    expect([before, ended(), sent()]).toEqual([false, true, ['SIGTERM']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is sent SIGKILL once the bound has passed if it is still there, no sooner', async () => {
    const { child, sent } = aFakeChild(77, 'SIGKILL');

    const ended = followed(endedWithin(endingOfChild(child), boundMs, fakeTimer));
    await vi.advanceTimersByTimeAsync(boundMs - 1);
    const beforeTheBound = [...sent()];
    await vi.advanceTimersByTimeAsync(11);

    expect([beforeTheBound, sent(), ended()]).toEqual([['SIGTERM'], ['SIGTERM', 'SIGKILL'], true]);
  });

  it.each([
    ['never started', undefined, false],
    ['ended of itself', 77, true],
  ])('is sent no signal when it %s', async (_how, pid, exitedFirst) => {
    const { child, sent, exited } = aFakeChild(pid, 'SIGTERM');
    const ending = endingOfChild(child);
    exited(exitedFirst);

    await endedWithin(ending, boundMs, fakeTimer);
    await ending.gone(new AbortController().signal);

    expect(sent()).toEqual([]);
  });
});

describe('a command a test could not start', () => {
  it('is sent no signal at the finish of the test, its child having no pid', async () => {
    const { finish, finished } = collected(fakeProcesses().signaller, fakeTimer);
    const child = spawnForTheTest(join(tmpdir(), 'no-such-command'), [], undefined, finish);
    const failed: readonly unknown[] = await once(child, 'error');

    await finished();

    expect([failed[0], child.pid, child.killed]).toMatchObject([{ code: 'ENOENT' }, undefined, false]);
  });
});

describe('the signal a pid is sent', () => {
  it('is sent where the pid is there, and is not where none is', () => {
    expect([signalled(process.pid, 0), signalled(2 ** 31 - 1, 0)]).toEqual([true, false]);
  });
});

describe('the timer a process is ended on', () => {
  it('is the one of node:timers/promises, which the fake timers of a test leave alone, and stops when told', async () => {
    await expect(realTimer.after(0, new AbortController().signal)).resolves.toBeUndefined();
    await expect(realTimer.after(stoppedWithinMs, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });
});

const stopsWhenTold = [
  "process.on('SIGTERM', () => { process.stdout.write('stopped'); process.exit(0); });",
  'setInterval(() => {}, 1000);',
  "process.stdout.write('ready ');",
].join('\n');

describe('the end of a process at the finish of its test, on a real process', () => {
  it('is registered with the test runner, which ends a child with SIGTERM and reads a pid to come', async () => {
    vi.useRealTimers();
    const reading = counted({ stillToCome: false });
    const printed = { text: '' };
    const left: { closed?: Promise<unknown[]> } = {};
    // Registered first, so the runner calls it last, once the ends registered below have run.
    onTestFinished(async () => {
      expect(await left.closed).toEqual([0, null]);
      expect([printed.text, reading.reads()]).toEqual(['ready stopped', 1]);
    });
    const child = spawnForTheTest(process.execPath, ['--eval', stopsWhenTold], {
      env: {},
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    left.closed = once(child, 'close');
    const { promise: ready, resolve } = Promise.withResolvers<void>();
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      printed.text += chunk;
      resolve();
    });
    endWithTheTest(reading.reader);

    await ready;

    expect([printed.text, reading.reads()]).toEqual(['ready ', 0]);
  });
});

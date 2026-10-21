import { Effect, Fiber, Function } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import type { StartedRuntime } from '../background-start/started-runtimes.ts';
import { stoppedRuntime } from './runtime-stop.ts';

const bounds = { stopWithinMs: 9100, killWithinMs: 2000, pingTries: 3 };

type Ending = 'on SIGTERM' | 'on SIGKILL' | 'before SIGKILL' | 'never' | 'already';

interface Stopping {
  readonly runtime: StartedRuntime;
  readonly signals: () => readonly string[];
}

function runtimeEnding(ending: Ending): Stopping {
  const signals: string[] = [];
  const end = Promise.withResolvers<void>();
  const endsOn: Readonly<Record<Ending, string | undefined>> = {
    'on SIGTERM': 'SIGTERM',
    'on SIGKILL': 'SIGKILL',
    'before SIGKILL': undefined,
    never: undefined,
    already: undefined,
  };
  return {
    signals: () => [...signals],
    runtime: {
      instance: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      pid: 4343,
      startedAt: 0,
      endedAt: Function.constUndefined,
      signal: (name) => {
        if (ending === 'already' || (ending === 'before SIGKILL' && name === 'SIGKILL')) {
          return false;
        }
        signals.push(name);
        if (endsOn[ending] === name) {
          end.resolve();
        }
        return true;
      },
      ended: end.promise,
    },
  };
}

function stoppedOnATestClock(runtime: StartedRuntime, log: (line: string) => void): Promise<boolean> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(stoppedRuntime(runtime, bounds, log));
      yield* TestClock.adjust(bounds.stopWithinMs + bounds.killWithinMs);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

const askedToStop =
  'Auto Runtime, process 4343, did not answer 3 pings, so this connection, which started it, sent it SIGTERM';

const toldToEnd = 'Auto Runtime, process 4343, did not end within 9.1 s of SIGTERM, so this connection sent it SIGKILL';

describe('stopping a runtime the relay started, which does not answer', () => {
  it('asks it with SIGTERM first, and says so once it did', async () => {
    const stopping = runtimeEnding('on SIGTERM');
    const logged: string[] = [];

    await expect(
      stoppedOnATestClock(stopping.runtime, (line) => {
        logged.push(line);
      }),
    ).resolves.toBe(true);
    expect(stopping.signals()).toEqual(['SIGTERM']);
    expect(logged).toEqual([askedToStop]);
  });

  it('sends SIGKILL once the longest stop of a runtime passed, and says so once it did', async () => {
    const stopping = runtimeEnding('on SIGKILL');
    const logged: string[] = [];

    await expect(
      stoppedOnATestClock(stopping.runtime, (line) => {
        logged.push(line);
      }),
    ).resolves.toBe(true);
    expect(stopping.signals()).toEqual(['SIGTERM', 'SIGKILL']);
    expect(logged).toEqual([askedToStop, toldToEnd]);
  });

  it('says so when it does not end even after SIGKILL', async () => {
    const stopping = runtimeEnding('never');
    const logged: string[] = [];

    await expect(
      stoppedOnATestClock(stopping.runtime, (line) => {
        logged.push(line);
      }),
    ).resolves.toBe(false);
    expect(logged).toEqual([askedToStop, toldToEnd, 'Auto Runtime, process 4343, did not end even after SIGKILL']);
  });
});

describe('stopping a runtime the relay started, which ended on its own meanwhile', () => {
  it('says nothing more of a runtime that ended before its SIGKILL, whose end its start logged', async () => {
    const stopping = runtimeEnding('before SIGKILL');
    const logged: string[] = [];

    await expect(
      stoppedOnATestClock(stopping.runtime, (line) => {
        logged.push(line);
      }),
    ).resolves.toBe(true);
    expect(logged).toEqual([askedToStop]);
  });

  it('signals nothing and says nothing of a runtime that had already ended, whose end its start logged', async () => {
    const stopping = runtimeEnding('already');
    const logged: string[] = [];

    await expect(
      stoppedOnATestClock(stopping.runtime, (line) => {
        logged.push(line);
      }),
    ).resolves.toBe(true);
    expect([stopping.signals(), logged]).toEqual([[], []]);
  });
});

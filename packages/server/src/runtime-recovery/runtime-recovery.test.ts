import { Effect, Fiber, Function } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import type { NotRunning } from '../background-start/background-start.ts';
import type { Sighted } from '../background-start/sighting.ts';
import type { StartedRuntime } from '../background-start/started-runtimes.ts';
import { impatient, type Patience } from '../local-runtime/runtime-probe.ts';
import { recovered, type Recovering, type Recovery } from './runtime-recovery.ts';

const ownInstance = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const ownRuntime: StartedRuntime = {
  instance: ownInstance,
  pid: 4343,
  startedAt: 0,
  endedAt: Function.constUndefined,
  signal: Function.constTrue,
  ended: Promise.resolve(),
};

const graceMs = 5000;

interface Situation {
  readonly startProblem?: NotRunning;
  readonly answersAfterLooks?: number;
  readonly sighted?: Sighted;
  readonly seenOnALookAgain?: Sighted;
  readonly stops?: boolean;
}

interface Recorded {
  readonly recovering: Recovering;
  readonly patiences: Patience[];
  readonly stopped: StartedRuntime[];
  readonly looks: () => number;
}

function recordingIn(situation: Situation = {}): Recorded {
  const {
    startProblem,
    answersAfterLooks = Number.POSITIVE_INFINITY,
    sighted,
    seenOnALookAgain,
    stops = true,
  } = situation;
  const patiences: Patience[] = [];
  const stopped: StartedRuntime[] = [];
  const looked = { times: 0 };
  return {
    patiences,
    stopped,
    looks: () => looked.times,
    recovering: {
      port: 5555,
      graceMs,
      answering: Effect.sync(() => {
        looked.times += 1;
        return looked.times >= answersAfterLooks;
      }),
      runningAfter: (patience) =>
        Effect.sync(() => {
          patiences.push(patience);
          return startProblem;
        }),
      sighted: () => sighted,
      lookedAgain: Effect.succeed(seenOnALookAgain),
      startedHere: (instance) => (instance === ownInstance ? ownRuntime : undefined),
      stopped: (runtime) =>
        Effect.sync(() => {
          stopped.push(runtime);
          return stops;
        }),
    },
  };
}

function onATestClock<A>(program: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
}

function recoveredFrom(seen: Parameters<typeof recovered>[0], recovering: Recovering): Promise<Recovery> {
  return onATestClock(recovered(seen, false, recovering));
}

describe('the recovery of a runtime the relay lost', () => {
  it('leaves a runtime that answers a ping as it is', async () => {
    const recording = recordingIn();

    await expect(recoveredFrom('answers', recording.recovering)).resolves.toEqual({ runs: true });
    expect(recording.patiences).toEqual([]);
  });

  it('starts one at once where the port refuses and never answered this relay', async () => {
    const recording = recordingIn();

    await expect(recoveredFrom('refused', recording.recovering)).resolves.toEqual({ runs: true });
    expect({ patiences: recording.patiences, looks: recording.looks() }).toEqual({ patiences: [impatient], looks: 0 });
  });

  it('says why when the runtime could not be started', async () => {
    const recording = recordingIn({ startProblem: { words: 'Auto Runtime did not start on port 5555' } });

    await expect(recoveredFrom('refused', recording.recovering)).resolves.toEqual({
      runs: false,
      words: 'Auto Runtime did not start on port 5555',
    });
  });

  it('passes on that another runtime took the port first, so that the relay can send to that one', async () => {
    const tookThePort: NotRunning = {
      words:
        'Another Auto Runtime took port 5555 first, so the one this connection started ended. Send the request again: it goes to the one on the port.',
      anotherAnswers: true,
    };
    const recording = recordingIn({ startProblem: tookThePort });

    await expect(recoveredFrom('refused', recording.recovering)).resolves.toEqual({ runs: false, ...tookThePort });
  });

  it.each<readonly ['asks for a credential' | 'not a runtime', string]>([
    [
      'asks for a credential',
      'Auto Runtime on port 5555 asks for a credential, as one started with PUBLIC_URL or API_KEYS does, so this connection cannot reach it. Ask the person to stop it, or connect to it over HTTP at http://localhost:5555/mcp as an MCP client that signs in.',
    ],
    ['not a runtime', 'Another program answers on port 5555; set PORT to start Auto Runtime on a free port'],
  ])('leaves alone a port that %s, and says what to do', async (seen, words) => {
    const recording = recordingIn();

    await expect(recoveredFrom(seen, recording.recovering)).resolves.toEqual({ runs: false, words });
    expect(recording.patiences).toEqual([]);
  });
});

describe('the grace a refused port that answered before is given', () => {
  it('ends as soon as the runtime answers again, with no start, so a server that restarts keeps its port', async () => {
    const recording = recordingIn({ answersAfterLooks: 3 });

    const recovery = await onATestClock(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(recovered('refused', true, recording.recovering));
        yield* TestClock.adjust(200);
        return yield* Fiber.join(waiting);
      }),
    );

    expect({ recovery, patiences: recording.patiences, looks: recording.looks() }).toEqual({
      recovery: { runs: true },
      patiences: [],
      looks: 3,
    });
  });

  it('starts a runtime once it passed with no answer, counted on the clock', async () => {
    const recording = recordingIn();

    const recovery = await onATestClock(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(recovered('refused', true, recording.recovering));
        yield* TestClock.adjust(graceMs - 1);
        const startedEarly = recording.patiences.length > 0;
        yield* TestClock.adjust(1);
        return { startedEarly, recovered: yield* Fiber.join(waiting) };
      }),
    );

    expect({ recovery, patiences: recording.patiences }).toEqual({
      recovery: { startedEarly: false, recovered: { runs: true } },
      patiences: [impatient],
    });
  });
});

describe('the grace a refused port that answered before is given, when nothing waits for it any more', () => {
  it('ends at once, with no start, when the relay that waits on it is interrupted', async () => {
    const recording = recordingIn();

    await onATestClock(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(recovered('refused', true, recording.recovering));
        yield* TestClock.adjust(1000);
        yield* Fiber.interrupt(waiting);
        yield* TestClock.adjust(graceMs);
      }),
    );

    expect(recording.patiences).toEqual([]);
  });
});

const ownSighted: Sighted = { instance: ownInstance, pid: 4343, startedBy: 'agent' };

describe('the recovery of a runtime this relay started that does not answer', () => {
  it('stops it, when it is the one last seen on the port, and starts another', async () => {
    const recording = recordingIn({ sighted: ownSighted });

    await expect(recoveredFrom('silent', recording.recovering)).resolves.toEqual({ runs: true });
    expect([recording.stopped, recording.patiences]).toEqual([[ownRuntime], [impatient]]);
  });

  it('says so when it does not end', async () => {
    const recording = recordingIn({ sighted: ownSighted, stops: false });

    await expect(recoveredFrom('silent', recording.recovering)).resolves.toEqual({
      runs: false,
      words:
        'Auto Runtime on port 5555 does not answer, and process 4343, which this connection started, did not end even after SIGKILL. Ask the person to end it, then send the request again.',
    });
    expect(recording.patiences).toEqual([]);
  });
});

const terminalSighted: Sighted = { instance: 'another', pid: 4242, startedBy: 'terminal' };

const notStartedHere =
  'Auto Runtime on port 5555 does not answer, and this connection did not start it, so it leaves it alone. Ask the person to stop the program that holds port 5555, then send the request again.';

describe('the recovery of a runtime another started that does not answer', () => {
  it.each<readonly [string, Sighted, string]>([
    [
      'started in a terminal',
      terminalSighted,
      'Auto Runtime on port 5555 does not answer. It was started in a terminal, as process 4242, so this connection leaves it alone: ask the person to stop it there with Ctrl+C, or to end process 4242, then send the request again.',
    ],
    [
      'started by another connection',
      { instance: 'another', pid: 4242, startedBy: 'agent' },
      'Auto Runtime on port 5555 does not answer. Another connection started it, as process 4242, so this one leaves it alone: ask the person to end process 4242, then send the request again.',
    ],
  ])(
    'names, from a look after the loss, the process of one %s, signals nothing, and says what to do',
    async (_case, seen, words) => {
      const recording = recordingIn({ sighted: seen, seenOnALookAgain: seen });

      await expect(recoveredFrom('silent', recording.recovering)).resolves.toEqual({ runs: false, words });
      expect([recording.stopped, recording.patiences]).toEqual([[], []]);
    },
  );

  it('names no process when the look after the loss sees none, whatever was seen before it', async () => {
    const recording = recordingIn({ sighted: terminalSighted });

    await expect(recoveredFrom('silent', recording.recovering)).resolves.toEqual({
      runs: false,
      words: notStartedHere,
    });
    expect(recording.stopped).toEqual([]);
  });

  it('leaves alone one it never saw answer, signals nothing, and says what to do', async () => {
    const recording = recordingIn();

    await expect(recoveredFrom('silent', recording.recovering)).resolves.toEqual({
      runs: false,
      words: notStartedHere,
    });
    expect(recording.stopped).toEqual([]);
  });
});

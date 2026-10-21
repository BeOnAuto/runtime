import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { impatient } from '../background-start/background-start.ts';
import type { Patience } from '../local-runtime/runtime-restarts.ts';
import { recovered, type Recovering } from './runtime-recovery.ts';

interface Starting {
  readonly recovering: Recovering;
  readonly patiences: Patience[];
  readonly looks: () => number;
}

const graceMs = 5000;

function startingThat(answers?: string, answersAfterLooks = Number.POSITIVE_INFINITY): Starting {
  const patiences: Patience[] = [];
  const looked = { times: 0 };
  return {
    patiences,
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
          return answers;
        }),
    },
  };
}

function onATestClock<A>(program: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));
}

describe('the recovery of a runtime the relay lost', () => {
  it('leaves a runtime that answers a ping as it is', async () => {
    const { recovering, patiences } = startingThat();

    await expect(onATestClock(recovered('answers', false, recovering))).resolves.toEqual({ runs: true });
    expect(patiences).toEqual([]);
  });

  it('starts one at once where the port refuses and never answered this relay', async () => {
    const { recovering, patiences, looks } = startingThat();

    await expect(onATestClock(recovered('refused', false, recovering))).resolves.toEqual({ runs: true });
    expect({ patiences, looks: looks() }).toEqual({ patiences: [impatient], looks: 0 });
  });

  it('says why when the runtime could not be started', async () => {
    const { recovering } = startingThat('Auto Runtime did not start on port 5555');

    await expect(onATestClock(recovered('refused', false, recovering))).resolves.toEqual({
      runs: false,
      words: 'Auto Runtime did not start on port 5555',
    });
  });

  it.each<readonly ['asks for a credential' | 'not a runtime' | 'silent', string]>([
    [
      'asks for a credential',
      'Auto Runtime on port 5555 asks for a credential, as one started with PUBLIC_URL or API_KEYS does, so this connection cannot reach it. Ask the person to stop it, or connect to it over HTTP at http://localhost:5555/mcp as an MCP client that signs in.',
    ],
    ['not a runtime', 'Another program answers on port 5555; set PORT to start Auto Runtime on a free port'],
    [
      'silent',
      'Auto Runtime on port 5555 does not answer, and this connection did not start it, so it leaves it alone. Ask the person to stop the program that holds port 5555, then send the request again.',
    ],
  ])('leaves alone a port that %s, and says what to do', async (seen, words) => {
    const { recovering, patiences } = startingThat();

    await expect(onATestClock(recovered(seen, false, recovering))).resolves.toEqual({ runs: false, words });
    expect(patiences).toEqual([]);
  });
});

describe('the grace a refused port that answered before is given', () => {
  it('ends as soon as the runtime answers again, with no start, so a server that restarts keeps its port', async () => {
    const { recovering, patiences, looks } = startingThat(undefined, 3);

    const recovery = await onATestClock(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(recovered('refused', true, recovering));
        yield* TestClock.adjust(200);
        return yield* Fiber.join(waiting);
      }),
    );

    expect({ recovery, patiences, looks: looks() }).toEqual({ recovery: { runs: true }, patiences: [], looks: 3 });
  });

  it('starts a runtime once it passed with no answer, counted on the clock', async () => {
    const { recovering, patiences } = startingThat();

    const recovery = await onATestClock(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(recovered('refused', true, recovering));
        yield* TestClock.adjust(graceMs - 1);
        const startedEarly = patiences.length > 0;
        yield* TestClock.adjust(1);
        return { startedEarly, recovered: yield* Fiber.join(waiting) };
      }),
    );

    expect({ recovery, patiences }).toEqual({
      recovery: { startedEarly: false, recovered: { runs: true } },
      patiences: [impatient],
    });
  });

  it('ends at once, with no start, when the relay that waits on it is interrupted', async () => {
    const { recovering, patiences } = startingThat();

    await onATestClock(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(recovered('refused', true, recovering));
        yield* TestClock.adjust(1000);
        yield* Fiber.interrupt(waiting);
        yield* TestClock.adjust(graceMs);
      }),
    );

    expect(patiences).toEqual([]);
  });
});

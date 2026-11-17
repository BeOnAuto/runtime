import { Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { type CapabilityAnswer, defineCapability } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { quietMs } from '../testing/capabilities/resumer.ts';
import { toPlaybook } from '../testing/harness.ts';
import { aProcess, aRunAClientStarts } from '../testing/held-attempts.ts';
import { acted, momentAfter, startedAndLeft } from '../testing/resumed-runs.ts';
import { drivingAShell } from '../testing/shell-drives.ts';
import { LiveAttempts } from './live-attempts.ts';

type Ending = 'made' | 'busy';

interface PaidAttempt {
  readonly started: Promise<void>;
  readonly ends: (ending: Ending) => void;
}

function aPaidAttempt() {
  const started = Promise.withResolvers<void>();
  const ending = Promise.withResolvers<Ending>();
  const busy = new Unavailable({ detail: 'The provider is busy' });
  const paid: PaidAttempt = { started: started.promise, ends: ending.resolve };
  const made = (output: string) =>
    Effect.suspend(() => {
      started.resolve();
      return Effect.flatMap(
        Effect.promise(() => ending.promise),
        (ended): Effect.Effect<CapabilityAnswer, Unavailable> =>
          ended === 'made' ? Effect.succeed({ output, record: {} }) : Effect.fail(busy),
      );
    });
  return { paid, made };
}

function aPaidRunMadeTwice() {
  const first = aPaidAttempt();
  const second = aPaidAttempt();
  const made = { count: 0 };
  const capability = defineCapability({
    type: 'paid-call',
    title: 'Paid call',
    guide: { name: 'paid-call' },
    noun: { one: 'paid call', other: 'paid calls' },
    describeOutput: () => 'It made something.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    run: () =>
      Effect.suspend(() => {
        made.count += 1;
        return made.count === 1 ? first.made('made by the first attempt') : second.made('made by the second attempt');
      }),
    longestRunOf: () => 300_000,
  });
  return { capability, first: first.paid, second: second.paid };
}

async function twoAttemptsAtOnce() {
  const { capability, first, second } = aPaidRunMadeTwice();
  const run = await aRunAClientStarts(capability, 'make');
  const firstProcess = aProcess();
  const secondProcess = aProcess();
  const answeringFirst = run.runningIn(firstProcess);
  await first.started;
  const answeringSecond = run.runningIn(secondProcess);
  await second.started;
  return { ...run, first, second, firstProcess, secondProcess, answeringFirst, answeringSecond };
}

describe('two attempts of a run under one id at once, the first ending without a final result', () => {
  it('records the result of the second, which holds the run, and tells the first the run is still running', async () => {
    const { first, second, answeringFirst, answeringSecond, reading } = await twoAttemptsAtOnce();

    first.ends('busy');
    const answeredFirst = await answeringFirst;
    second.ends('made');
    const answeredSecond = await answeringSecond;

    expect(answeredFirst).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'taken' });
    expect(answeredSecond).toMatchObject({ status: 'succeeded', output: { output: 'made by the second attempt' } });
    expect(await reading()).toMatchObject({ output: { status: 'succeeded', output: 'made by the second attempt' } });
  });
});

describe('two attempts of a run under one id at once, the first ending with a result', () => {
  it('keeps that result, so the second ending without one discards nothing that was paid for', async () => {
    const { first, second, answeringFirst, answeringSecond, reading } = await twoAttemptsAtOnce();

    first.ends('made');
    await answeringFirst;
    second.ends('busy');

    expect(await answeringSecond).toMatchObject({
      status: 'succeeded',
      output: { output: 'made by the first attempt' },
    });
    expect(await reading()).toMatchObject({ output: { status: 'succeeded', output: 'made by the first attempt' } });
  });
});

describe('a run whose first attempt died and which a retry under its id started again in another process', () => {
  it('is not ended for the attempt that died, so the retry that holds it records its result', async () => {
    const { second, firstProcess, secondProcess, answeringSecond, endingTheAttemptOf, reading } =
      await twoAttemptsAtOnce();

    const endedForTheFirst = await endingTheAttemptOf(firstProcess);
    second.ends('made');

    expect([firstProcess.acquired(), secondProcess.acquired()]).toEqual([1, 2]);
    expect(endedForTheFirst).toBe('not_running');
    expect(await answeringSecond).toMatchObject({ status: 'succeeded' });
    expect(await reading()).toMatchObject({ output: { status: 'succeeded', output: 'made by the second attempt' } });
  });

  it('is ended for the attempt that holds it, once a shell knows that one died too', async () => {
    const { secondProcess, endingTheAttemptOf, reading } = await twoAttemptsAtOnce();

    expect(await endingTheAttemptOf(secondProcess)).toBe('ended');
    expect(await reading()).toMatchObject({ output: { status: 'failed' } });
  });
});

describe('the next attempt of a run that resumes, claimed by a shell', () => {
  it('tells the shell the token it holds the run by, the one after the attempt that died', async () => {
    const started = await startedAndLeft();
    const drive = drivingAShell([started.resuming.capability], started.resuming.capability);
    const shell = aProcess();
    const request = toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: acted.runId });

    const driven = await started.run(
      started.dispatch(drive, request).pipe(Effect.provideService(LiveAttempts, shell.live)),
      momentAfter(quietMs + 1),
    );

    expect(driven).toMatchObject({ status: 'succeeded', output: { next: 'attempt', status: 'succeeded' } });
    expect(shell.acquired()).toBe(2);
  });
});

describe("the attempt of a run that resumes, made by a workflow's call under its id once the attempt before died", () => {
  it('tells the shell the token it goes on under, that of the attempt it takes over, since it claims none', async () => {
    const started = await startedAndLeft();
    const shell = aProcess();

    const resumed = await started.run(
      started.askedByACall(true).pipe(Effect.provideService(LiveAttempts, shell.live)),
      momentAfter(1),
    );

    expect(resumed).toMatchObject({ status: 'succeeded' });
    expect(shell.acquired()).toBe(1);
  });
});

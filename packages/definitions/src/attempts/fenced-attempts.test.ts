import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../index.ts';
import { aProcess, aRunAClientStarts } from '../testing/held-attempts.ts';

const longestCallMs = 70_000;

const sent = { server: 'slack', tool: 'post_message', arguments_bytes: 2 };

const answered = { is_error: false, result_bytes: 2, duration_ms: 5, jsonrpc_id: 1 };

const notRecorded = new Error('The start of the call could not be recorded on its run, so the call was not sent');

interface Holder {
  readonly capability: Capability;
  readonly calling: Promise<void>;
  readonly goOn: () => void;
  readonly sent: () => number;
}

interface Holding {
  readonly stallsBeforeItsCall?: boolean;
  readonly triesAnotherCall?: boolean;
}

function aHolderOfTheRun({ stallsBeforeItsCall = false, triesAnotherCall = false }: Holding = {}): Holder {
  const calling = Promise.withResolvers<void>();
  const goingOn = Promise.withResolvers<void>();
  const sends = { count: 0 };
  const sentOnceRecorded = (number: number | undefined) =>
    number === undefined
      ? Effect.die(notRecorded)
      : Effect.sync(() => {
          sends.count += 1;
          return number;
        });
  const stalled = Effect.andThen(
    Effect.sync(() => {
      calling.resolve();
    }),
    Effect.promise(() => goingOn.promise),
  );
  const capability = defineCapability({
    type: 'system-call',
    title: 'System call',
    guide: { name: 'system-call' },
    noun: { one: 'system call', other: 'system calls' },
    describeOutput: () => 'It called a system.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    run: (_source, _input, { journal }) =>
      Effect.gen(function* () {
        yield* stallsBeforeItsCall ? stalled : Effect.void;
        const number = yield* sentOnceRecorded(yield* journal.started({ call_id: 'toolu_1', ...sent }));
        yield* stallsBeforeItsCall ? Effect.void : stalled;
        yield* journal.ended(number, { type: 'tool_call_answered', data: answered });
        if (triesAnotherCall) {
          yield* sentOnceRecorded(yield* journal.started({ call_id: 'toolu_2', ...sent }));
        }
        return { output: 'posted', record: {} };
      }),
    reachesOutside: true,
    mayChangeOutside: true,
    callsTools: () => true,
    longestRunOf: () => longestCallMs,
  });
  const goOn = () => {
    goingOn.resolve();
  };
  return { capability, calling: calling.promise, goOn, sent: () => sends.count };
}

async function endedWhileItsHolderStalls(holder: Holder) {
  const died = aProcess();
  const run = await aRunAClientStarts(holder.capability, 'post');
  const running = run.runningIn(died);
  await holder.calling;
  return { ...run, died, running };
}

describe('the holder of a run whose attempt a shell ended as dead, which turns out to be alive, with its call answered', () => {
  it('records its result, a result never being discarded, while its call ends unrecorded and was sent once', async () => {
    const holder = aHolderOfTheRun();
    const { died, running, endingTheAttemptOf, reading, recorded } = await endedWhileItsHolderStalls(holder);

    expect(await endingTheAttemptOf(died)).toBe('ended');
    holder.goOn();

    expect(await running).toMatchObject({ status: 'succeeded' });
    expect(await recorded()).toEqual([
      'run_started',
      'tool_call_started',
      'tool_call_failed',
      'run_rejected',
      'run_succeeded',
    ]);
    expect(holder.sent()).toBe(1);
    expect(await reading()).toMatchObject({ output: { status: 'succeeded', output: 'posted' } });
  });
});

describe('the holder of a run whose attempt a shell ended as dead, which turns out to be alive, trying another call', () => {
  it('sends no other call, its start refused on the ended run, and adds no second ending', async () => {
    const holder = aHolderOfTheRun({ triesAnotherCall: true });
    const { died, running, endingTheAttemptOf, reading, recorded } = await endedWhileItsHolderStalls(holder);

    await endingTheAttemptOf(died);
    holder.goOn();

    expect(await running).toMatchObject({ status: 'failed' });
    expect(await recorded()).toEqual(['run_started', 'tool_call_started', 'tool_call_failed', 'run_rejected']);
    expect(holder.sent()).toBe(1);
    expect(await reading()).toMatchObject({ output: { status: 'rejected', rejection: { kind: 'effect_unknown' } } });
  });

  it('is not made again under its id once it called a tool, so its call is never made twice', async () => {
    const holder = aHolderOfTheRun();
    const { died, running, endingTheAttemptOf, runningIn } = await endedWhileItsHolderStalls(holder);
    await endingTheAttemptOf(died);

    const startedAgain = await runningIn(aProcess());
    holder.goOn();
    await running;

    expect(startedAgain).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'tools_called' });
    expect(holder.sent()).toBe(1);
  });
});

describe('a run whose attempt a shell ended as dead before it called its tool, its holder alive', () => {
  it('may be started again under its id, its call sent once, by the new attempt, the holder that wakes sending nothing', async () => {
    const holder = aHolderOfTheRun({ stallsBeforeItsCall: true });
    const { died, running, endingTheAttemptOf, runningIn, reading, recorded } = await endedWhileItsHolderStalls(holder);
    await endingTheAttemptOf(died);

    const startedAgain = runningIn(aProcess());
    holder.goOn();
    const [answeredToTheHolder, answeredAgain] = await Promise.all([running, startedAgain]);

    expect([answeredToTheHolder, answeredAgain]).toMatchObject([{ status: 'failed' }, { status: 'succeeded' }]);
    expect(holder.sent()).toBe(1);
    expect(await recorded()).toEqual([
      'run_started',
      'run_failed',
      'run_started',
      'tool_call_started',
      'tool_call_answered',
      'run_succeeded',
    ]);
    expect(await reading()).toMatchObject({ output: { status: 'succeeded', output: 'posted' } });
  });
});

describe('a run whose holder finished before a shell ended its attempt as dead', () => {
  it('is not running, and keeps the ending its holder recorded', async () => {
    const holder = aHolderOfTheRun();
    const { died, running, endingTheAttemptOf, reading, recorded } = await endedWhileItsHolderStalls(holder);
    holder.goOn();
    await running;

    expect(await endingTheAttemptOf(died)).toBe('not_running');
    expect(await reading()).toMatchObject({ output: { status: 'succeeded', output: 'posted' } });
    expect(await recorded()).toEqual(['run_started', 'tool_call_started', 'tool_call_answered', 'run_succeeded']);
  });
});

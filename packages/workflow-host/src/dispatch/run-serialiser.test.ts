import { statement } from '@on.auto/ledger';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { keyOfTheRun, ranOn } from '../closing-testing/ended-runs.ts';
import { runSerialiser } from './run-serialiser.ts';
import { sqlWatermark } from './sql-watermark.ts';

interface Journal {
  readonly step: (line: string) => Effect.Effect<void>;
  readonly lines: () => readonly string[];
}

function journal(): Journal {
  const lines: string[] = [];
  return {
    step: (line) =>
      Effect.sync(() => {
        lines.push(line);
      }),
    lines: () => lines,
  };
}

describe('the serialiser of the host', () => {
  it('takes one input of a run at a time, and inputs of two runs at once', async () => {
    const { serialise } = runSerialiser();
    const { step, lines } = journal();
    const release = Deferred.makeUnsafe<void>();
    const held = step('first of alpha begins').pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.andThen(step('first of alpha ends')),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(serialise('alpha', held));
        yield* Effect.yieldNow;
        const second = yield* Effect.forkChild(serialise('alpha', step('second of alpha')));
        yield* serialise('beta', step('first of beta'));
        yield* Deferred.done(release, Exit.void);
        yield* Fiber.joinAll([first, second]);
        yield* serialise('alpha', step('third of alpha'));
      }),
    );

    expect(lines()).toEqual([
      'first of alpha begins',
      'first of beta',
      'first of alpha ends',
      'second of alpha',
      'third of alpha',
    ]);
  });
});

const run = '0199a3c4-7d2e-7c1a-9b3f-00000000000a';

describe('the runs whose dispatch is behind the version of their log', () => {
  it('leaves out a run whose log the event store archived, with its own mark, as a run whose log was never written', async () => {
    const database = await ranOn([run]);
    await Effect.runPromise(database.write(statement`UPDATE workflow_runs SET dispatched_through = 0`));
    const watermark = sqlWatermark(database);

    const behind = await Effect.runPromise(watermark.behindRuns(10));
    await Effect.runPromise(
      Effect.forEach(
        [
          statement`UPDATE emt_streams SET is_archived = TRUE WHERE stream_id IN (SELECT stream_id FROM workflow_runs)`,
          statement`UPDATE emt_messages SET is_archived = TRUE WHERE stream_id IN (SELECT stream_id FROM workflow_runs)`,
        ],
        (archived) => database.write(archived),
        { discard: true },
      ),
    );
    const behindAfterTheArchive = await Effect.runPromise(watermark.behindRuns(10));

    expect([behind, behindAfterTheArchive]).toEqual([[keyOfTheRun(run)], []]);
  });
});

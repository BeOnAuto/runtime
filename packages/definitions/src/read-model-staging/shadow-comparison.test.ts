import { NotFound } from '@on.auto/operations';
import { Effect, Fiber, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { ReadModelRefused } from '../read-model-reads/read-model-refused.ts';
import { capturedLogs, type CapturedLog } from '../read-model-testing/captured-logs.ts';
import { DefinitionsReadModel, type ReadModelStage, type StagedReading } from './read-model-stage.ts';
import { sameAnswer } from './same-answers.ts';
import {
  candidateBudgetMs,
  comparedMessage,
  comparisonOf,
  fellBackMessage,
  matched,
  stagedRead,
  type Comparison,
} from './shadow-comparison.ts';

interface Answer {
  readonly name: string;
  readonly version: number;
}

const plain: Answer = { name: 'plain', version: 2 };

const notFound = new NotFound({ detail: 'There is no probe plain in this playbook' });

function flattened({ message, level, annotations }: CapturedLog) {
  return { message, level, ...annotations };
}

function sameOrNot(found: Answer, other: Answer): Effect.Effect<Comparison> {
  return Effect.succeed(sameAnswer(found, other) ? matched : comparisonOf(['version']));
}

interface Staging {
  readonly stage: ReadModelStage;
  readonly reading?: StagedReading;
  compared?(this: void, found: Answer, other: Answer): Effect.Effect<Comparison>;
  answerCompared?(this: void, found: Answer, other: Answer): Answer;
}

function stagedOf({ stage, reading = 'answers', compared = sameOrNot, answerCompared }: Staging) {
  return (today: Effect.Effect<Answer, NotFound>, candidate: Effect.Effect<Answer, NotFound | ReadModelRefused>) =>
    stagedRead({
      read: 'version',
      reading,
      definitionType: 'probe',
      involved: ['probe'],
      today,
      fromTheReadModel: candidate,
      answerOf: (found) => found,
      compared,
      ...(answerCompared === undefined ? {} : { answerCompared }),
    }).pipe(
      Effect.catchTag('not_found', () => Effect.succeed('not found')),
      Effect.catchDefect(() => Effect.succeed('died')),
      Effect.provideService(DefinitionsReadModel, { stage, folds: ['probe'] }),
    );
}

function read(
  staging: Staging,
  today: Effect.Effect<Answer, NotFound>,
  candidate: Effect.Effect<Answer, NotFound | ReadModelRefused>,
) {
  const logs = capturedLogs();
  return Effect.runPromise(
    stagedOf(staging)(today, candidate).pipe(
      Effect.provide(Logger.layer([logs.logger])),
      Effect.map((answered) => ({ answered, logged: logs.logged().map((log) => flattened(log)) })),
    ),
  );
}

const newer: Effect.Effect<Answer, NotFound | ReadModelRefused> = Effect.succeed({ name: 'plain', version: 3 });

const neverAsked: Effect.Effect<Answer, NotFound | ReadModelRefused> = Effect.die(
  new Error('The read model was asked'),
);

const todayNeverAsked: Effect.Effect<Answer, NotFound> = Effect.die(new Error('Today was asked'));

function comparedAs(outcome: string, differing: string, level = 'INFO', kind: Readonly<Record<string, string>> = {}) {
  return { message: comparedMessage, level, read: 'version', definition_type: 'probe', outcome, differing, ...kind };
}

describe('a read staged between today and the read model', () => {
  it('answers from today alone while the stage is off, and never asks the read model', async () => {
    expect(await read({ stage: 'off' }, Effect.succeed(plain), neverAsked)).toEqual({ answered: plain, logged: [] });
  });

  it('answers from today in shadow and logs what the read model answered against it', async () => {
    expect([
      await read({ stage: 'shadow' }, Effect.succeed(plain), Effect.succeed(plain)),
      await read({ stage: 'shadow' }, Effect.succeed(plain), newer),
    ]).toEqual([
      { answered: plain, logged: [comparedAs('matched', '')] },
      { answered: plain, logged: [comparedAs('mismatched', 'version', 'WARN')] },
    ]);
  });

  it('answers from the read model at reads, where run starts are still compared, and both at on', async () => {
    expect([
      await read({ stage: 'reads' }, todayNeverAsked, newer),
      await read({ stage: 'reads', reading: 'run_starts' }, Effect.succeed(plain), Effect.succeed(plain)),
      await read({ stage: 'on', reading: 'run_starts' }, todayNeverAsked, newer),
    ]).toEqual([
      { answered: { name: 'plain', version: 3 }, logged: [] },
      { answered: plain, logged: [comparedAs('matched', '')] },
      { answered: { name: 'plain', version: 3 }, logged: [] },
    ]);
  });
});

describe('a read staged between today and the read model that fails', () => {
  it('compares failures by their kind and fields, names what failed, and answers as today did', async () => {
    const otherwise = new NotFound({ detail: 'There is no version 3 of the probe plain in this playbook' });

    expect(
      await Promise.all([
        read({ stage: 'shadow' }, Effect.fail(notFound), Effect.fail(notFound)),
        read({ stage: 'shadow' }, Effect.fail(notFound), Effect.fail(otherwise)),
        read({ stage: 'shadow' }, Effect.succeed(plain), neverAsked),
        read({ stage: 'shadow' }, Effect.fail(notFound), Effect.succeed(plain)),
        read(
          { stage: 'shadow' },
          Effect.succeed(plain),
          Effect.fail(new ReadModelRefused({ because: 'checks_failed' })),
        ),
        read({ stage: 'shadow' }, Effect.succeed(plain), Effect.die('broken')),
        read({ stage: 'shadow' }, Effect.succeed(plain), Effect.die(null)),
      ]),
    ).toEqual([
      { answered: 'not found', logged: [comparedAs('matched', '')] },
      { answered: 'not found', logged: [comparedAs('mismatched', 'detail', 'WARN')] },
      { answered: plain, logged: [comparedAs('mismatched', 'failed', 'WARN', { failed_kind: 'Error' })] },
      { answered: 'not found', logged: [comparedAs('mismatched', 'outcome', 'WARN', { failed_kind: 'not_found' })] },
      {
        answered: plain,
        logged: [comparedAs('mismatched', 'outcome', 'WARN', { failed_kind: 'read_model_refused' })],
      },
      { answered: plain, logged: [comparedAs('mismatched', 'failed', 'WARN', { failed_kind: 'string' })] },
      { answered: plain, logged: [comparedAs('mismatched', 'failed', 'WARN', { failed_kind: 'object' })] },
    ]);
  });
});

function dies(): Effect.Effect<Comparison> {
  return Effect.die(new RangeError('The comparator broke'));
}

function throws(): Effect.Effect<Comparison> {
  throw new TypeError('The comparator threw');
}

function answerThrows(): Answer {
  throw new TypeError('The answer threw');
}

describe('a comparison that fails, at any of its steps', () => {
  it('never changes or fails the answer today gave: a comparator that dies, throws, or an answer that throws', async () => {
    expect(
      await Promise.all([
        read({ stage: 'shadow', compared: dies }, Effect.succeed(plain), newer),
        read({ stage: 'shadow', compared: throws }, Effect.succeed(plain), newer),
        read({ stage: 'shadow', answerCompared: answerThrows }, Effect.succeed(plain), Effect.succeed(plain)),
        read({ stage: 'shadow', answerCompared: (found) => ({ ...found, version: 9 }) }, Effect.succeed(plain), newer),
      ]),
    ).toEqual([
      { answered: plain, logged: [comparedAs('mismatched', 'failed', 'WARN', { failed_kind: 'RangeError' })] },
      { answered: plain, logged: [] },
      { answered: plain, logged: [comparedAs('matched', '')] },
      { answered: { name: 'plain', version: 9 }, logged: [comparedAs('mismatched', 'version', 'WARN')] },
    ]);
  });

  it('never fails the answer when its log line cannot be written', async () => {
    const throwing = Logger.make(() => {
      throw new Error('The log is unwritable');
    });

    expect(
      await Effect.runPromise(
        stagedOf({ stage: 'shadow' })(Effect.succeed(plain), newer).pipe(Effect.provide(Logger.layer([throwing]))),
      ),
    ).toEqual(plain);
  });
});

describe('a read model slower than its budget', () => {
  it('waits for the read model a second at most, then answers as today and logs that it timed out', async () => {
    const logs = capturedLogs();
    const slow: Effect.Effect<Answer, NotFound | ReadModelRefused> = Effect.as(Effect.sleep('5 seconds'), plain);

    const answered = await Effect.runPromise(
      Effect.gen(function* () {
        const reading = yield* Effect.forkChild(stagedOf({ stage: 'shadow' })(Effect.succeed(plain), slow));
        yield* TestClock.adjust(candidateBudgetMs);
        return yield* Fiber.join(reading);
      }).pipe(Effect.provide(TestClock.layer()), Effect.provide(Logger.layer([logs.logger]))),
    );

    expect([answered, logs.logged().map((log) => flattened(log))]).toEqual([
      plain,
      [comparedAs('mismatched', 'timed_out', 'WARN')],
    ]);
  });
});

function fellBackAs(level: string, because: string, kind: Readonly<Record<string, string>> = {}) {
  return { message: fellBackMessage, level, read: 'version', definition_type: 'probe', because, ...kind };
}

describe('a read the read model cannot answer, where the read model answers', () => {
  it("falls back to today's answer on a refusal, a defect or a failure, and only today's own failure fails it", async () => {
    const refused = Effect.fail(new ReadModelRefused({ because: 'pointer_disagrees' }));
    const broken = Effect.die(new RangeError('The read model broke'));

    expect(
      await Promise.all([
        read({ stage: 'on' }, Effect.succeed(plain), refused),
        read({ stage: 'on' }, Effect.succeed(plain), broken),
        read({ stage: 'on' }, Effect.succeed(plain), Effect.fail(notFound)),
        read({ stage: 'on' }, Effect.fail(notFound), Effect.fail(notFound)),
        read({ stage: 'on' }, Effect.fail(notFound), refused),
        read({ stage: 'on' }, Effect.die(new RangeError('Today broke')), Effect.fail(notFound)),
      ]),
    ).toEqual([
      { answered: plain, logged: [fellBackAs('WARN', 'pointer_disagrees')] },
      { answered: plain, logged: [fellBackAs('ERROR', 'failed', { failed_kind: 'RangeError' })] },
      { answered: plain, logged: [fellBackAs('ERROR', 'failed', { failed_kind: 'not_found' })] },
      { answered: 'not found', logged: [fellBackAs('INFO', 'failed', { failed_kind: 'not_found' })] },
      { answered: 'not found', logged: [fellBackAs('WARN', 'pointer_disagrees')] },
      { answered: 'died', logged: [fellBackAs('ERROR', 'failed', { failed_kind: 'not_found' })] },
    ]);
  });
});

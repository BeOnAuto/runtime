import { NotFound } from '@on.auto/operations';
import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { capturedLogs, type CapturedLog } from '../read-model-testing/captured-logs.ts';
import { DefinitionsReadModel, type ReadModelStage, type StagedReading } from './read-model-stage.ts';
import { sameAnswer } from './same-answers.ts';
import { comparedMessage, comparisonOf, matched, stagedRead } from './shadow-comparison.ts';

interface Answer {
  readonly name: string;
  readonly version: number;
}

const plain: Answer = { name: 'plain', version: 2 };

const notFound = new NotFound({ detail: 'There is no probe plain in this playbook' });

function flattened({ message, level, annotations }: CapturedLog) {
  return { message, level, ...annotations };
}

function read(
  stage: ReadModelStage,
  reading: StagedReading,
  today: Effect.Effect<Answer, NotFound>,
  candidate: Effect.Effect<Answer, NotFound>,
) {
  const logs = capturedLogs();
  const staged = stagedRead({
    read: 'version',
    reading,
    definitionType: 'probe',
    involved: ['probe'],
    today,
    fromTheReadModel: candidate,
    answerOf: (found) => found,
    compared: (found, other) => Effect.succeed(sameAnswer(found, other) ? matched : comparisonOf(['version'])),
  });
  return Effect.runPromise(
    staged.pipe(
      Effect.catchTag('not_found', () => Effect.succeed('not found')),
      Effect.provideService(DefinitionsReadModel, { stage, folds: ['probe'] }),
      Effect.provide(Logger.layer([logs.logger])),
      Effect.map((answered) => ({ answered, logged: logs.logged().map((log) => flattened(log)) })),
    ),
  );
}

const newer: Effect.Effect<Answer, NotFound> = Effect.succeed({ name: 'plain', version: 3 });

const neverAsked: Effect.Effect<Answer, NotFound> = Effect.die(new Error('The read model was asked'));

function comparedAs(outcome: string, differing: string, level = 'INFO') {
  return { message: comparedMessage, level, read: 'version', definition_type: 'probe', outcome, differing };
}

describe('a read staged between today and the read model', () => {
  it('answers from today alone while the stage is off, and never asks the read model', async () => {
    expect(await read('off', 'answers', Effect.succeed(plain), neverAsked)).toEqual({ answered: plain, logged: [] });
  });

  it('answers from today in shadow and logs what the read model answered against it', async () => {
    expect([
      await read('shadow', 'answers', Effect.succeed(plain), Effect.succeed(plain)),
      await read('shadow', 'answers', Effect.succeed(plain), newer),
    ]).toEqual([
      { answered: plain, logged: [comparedAs('matched', '')] },
      { answered: plain, logged: [comparedAs('mismatched', 'version', 'WARN')] },
    ]);
  });

  it('answers from the read model at reads, where run starts are still compared, and both at on', async () => {
    expect([
      await read('reads', 'answers', neverAsked, newer),
      await read('reads', 'run_starts', Effect.succeed(plain), Effect.succeed(plain)),
      await read('on', 'run_starts', neverAsked, newer),
    ]).toEqual([
      { answered: { name: 'plain', version: 3 }, logged: [] },
      { answered: plain, logged: [comparedAs('matched', '')] },
      { answered: { name: 'plain', version: 3 }, logged: [] },
    ]);
  });

  it('compares failures by their kind and fields, takes a read model that died as mismatched, and fails as today did', async () => {
    const otherwise = new NotFound({ detail: 'There is no version 3 of the probe plain in this playbook' });

    expect(
      await Promise.all([
        read('shadow', 'answers', Effect.fail(notFound), Effect.fail(notFound)),
        read('shadow', 'answers', Effect.fail(notFound), Effect.fail(otherwise)),
        read('shadow', 'answers', Effect.succeed(plain), neverAsked),
        read('shadow', 'answers', Effect.fail(notFound), Effect.succeed(plain)),
      ]),
    ).toEqual([
      { answered: 'not found', logged: [comparedAs('matched', '')] },
      { answered: 'not found', logged: [comparedAs('mismatched', 'detail', 'WARN')] },
      { answered: plain, logged: [comparedAs('mismatched', 'failed', 'WARN')] },
      { answered: 'not found', logged: [comparedAs('mismatched', 'outcome', 'WARN')] },
    ]);
  });
});

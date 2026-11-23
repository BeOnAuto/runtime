import { Conflict } from '@on.auto/operations';
import type { IntakeAnswer } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { listedIntakeOf } from './subscription-rounds.ts';

const arrival = {
  playbook: { org: 'acme', playbook: 'alpha' },
  connection: 'tracker',
  event: { type: 'com.example.tracker.issue.created', id: 'i-1', data: {} },
  topic: 'site',
};

const answers: readonly (readonly [string, Effect.Effect<IntakeAnswer, Conflict>, string])[] = [
  ['taken', Effect.succeed({ outcome: 'taken' }), 'taken'],
  ['not taken', Effect.succeed({ outcome: 'not_taken', reasons: ['no_trigger'] }), 'not_taken'],
  ['refused', Effect.succeed({ outcome: 'refused' }), 'held'],
  ['failed', Effect.fail(new Conflict({ detail: 'moved' })), 'held'],
];

describe('an item a check lists, handed to the intake of a connection’s events', () => {
  it.each(answers)(
    'is, where the intake answers %s, %s, held to be listed again where it refuses or fails',
    async (_answer, answered, taken) => {
      const asked: unknown[] = [];
      const takeIn = listedIntakeOf((each) =>
        Effect.andThen(
          Effect.sync(() => asked.push(each)),
          answered,
        ),
      );

      expect(await Effect.runPromise(takeIn(arrival))).toBe(taken);
      expect(asked).toEqual([arrival]);
    },
  );
});

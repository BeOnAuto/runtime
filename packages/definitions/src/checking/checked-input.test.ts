import { compileJsonSchema } from '@on.auto/json-schema';
import { InvalidInput } from '@on.auto/operations';
import { Effect, Exit, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { checkedInput, refusedInput } from '../index.ts';

describe('the check of the input of a run', () => {
  const booking = Result.getOrThrow(
    compileJsonSchema(
      {
        type: 'object',
        properties: { seats: { type: 'integer', minimum: 1 }, on: { type: 'string', format: 'date' } },
      },
      { what: 'input', nesting: 512 },
    ),
  );
  const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], 'x');

  it('takes an input its schema takes, and any input of a function without one, as it is', () => {
    expect([
      Effect.runSyncExit(checkedInput({ seats: 2, on: '2026-04-01' }, booking, 'booking function')),
      Effect.runSyncExit(checkedInput('anything', undefined, 'booking function')),
    ]).toEqual([Exit.succeed({ seats: 2, on: '2026-04-01' }), Exit.succeed('anything')]);
  });

  it('refuses an input its schema refuses in the words of its fields, and one nested past a value, naming the noun', () => {
    expect([
      Effect.runSyncExit(checkedInput({ seats: 0 }, booking, 'booking function')),
      Effect.runSyncExit(checkedInput({ seats: 2, on: 'April' }, booking, 'booking function')),
      Effect.runSyncExit(checkedInput(deep, undefined, 'interaction function')),
    ]).toEqual([
      Exit.fail(refusedInput([{ pointer: '/seats', detail: 'seats: expected at least 1.' }])),
      Exit.fail(refusedInput([{ pointer: '/on', detail: 'on: expected a date such as 2026-04-01.' }])),
      Exit.fail(
        new InvalidInput({
          detail: 'The input nests more than the 512 levels an interaction function takes',
          issues: [{ pointer: '', detail: 'Expected a value nested at most 512 levels deep' }],
        }),
      ),
    ]);
  });
});

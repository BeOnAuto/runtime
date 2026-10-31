import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { OperationsServed } from '../index.ts';

const servesTheSearch = Effect.gen(function* () {
  const serves = yield* OperationsServed;
  return serves('search');
});

describe('the operations served beside a call', () => {
  it('are every operation unless the server serving it names them', () => {
    expect(Effect.runSync(servesTheSearch)).toBe(true);
    expect(
      Effect.runSync(servesTheSearch.pipe(Effect.provideService(OperationsServed, (name) => name === 'get_guide'))),
    ).toBe(false);
  });
});

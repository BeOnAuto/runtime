import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ServedAsTool } from '../index.ts';

const servedAsTool = Effect.gen(function* () {
  return yield* ServedAsTool;
});

describe('whether a call is served as a tool', () => {
  it('is not unless the server serving it says so', () => {
    expect(Effect.runSync(servedAsTool)).toBe(false);
    expect(Effect.runSync(servedAsTool.pipe(Effect.provideService(ServedAsTool, true)))).toBe(true);
  });
});

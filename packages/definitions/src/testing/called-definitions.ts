import { Effect } from 'effect';

import type { RunContext } from '../index.ts';

function nothingKnown(): Effect.Effect<undefined> {
  return Effect.undefined;
}

export const noCalledDefinitions: Pick<RunContext, 'longestRunOf' | 'longestRunFor' | 'resumesAfterOf'> = {
  longestRunOf: nothingKnown,
  longestRunFor: nothingKnown,
  resumesAfterOf: nothingKnown,
};

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { mostSourcesKept } from '../operations/answered-definitions.ts';
import { echoDeclaration } from '../testing/capabilities/echo.ts';
import { warningsAtAnOpen } from './remembered-warnings.ts';

const foundToday = JSON.stringify({ greeting: 'Hi', warnings: ['found today'] });

function counted(): { readonly capability: Capability; readonly checks: () => number } {
  const checking = defineCapability(echoDeclaration);
  let checks = 0;
  return {
    capability: {
      ...checking,
      prepare: (source, stripped) => {
        checks += 1;
        return checking.prepare(source, stripped);
      },
    },
    checks: () => checks,
  };
}

describe('the warnings a process remembers of the definitions it opened', () => {
  it(`are kept for at most ${mostSourcesKept} saving facts, and found again once forgotten`, async () => {
    const { capability, checks } = counted();
    const opened = (savedBy: string) =>
      Effect.runPromise(warningsAtAnOpen(capability, { savedBy, document: foundToday, saved: [] }));

    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: mostSourcesKept + 1 }, (_, index) => `saved-by-${index}`),
        (savedBy) => Effect.promise(() => opened(savedBy)),
      ),
    );
    await opened(`saved-by-${mostSourcesKept}`);
    await opened('saved-by-0');

    expect(checks()).toBe(mostSourcesKept + 2);
  });

  it('are those it was saved with when the document no longer parses', async () => {
    expect(
      await Effect.runPromise(
        warningsAtAnOpen(defineCapability(echoDeclaration), {
          savedBy: 'saved-by',
          document: '{',
          saved: ['as saved'],
        }),
      ),
    ).toEqual(['as saved']);
  });
});

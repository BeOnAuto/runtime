import { playbookCallerOf } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineStartVersion, LiveAttempts } from '../index.ts';
import { asking } from '../testing/asking.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { aProcess } from '../testing/held-attempts.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const thePlaybook = playbookCallerOf({ org: 'acme', playbook: 'alpha' });

describe('a start once whose run finishes later, in a process that keeps its live attempts', () => {
  it('is made outside them, since only its settlement ends it, while one of the same definition that answers in its call is made inside', async () => {
    const definitions = harness();
    const { createDefinition: creatingAQuestion } = definitionOperationsFor([asking]);
    await definitions.call(
      creatingAQuestion,
      toAlpha(acmeAdmin, { type: 'asking', name: 'approve', source: 'Approve?' }),
    );
    const startingAQuestion = defineStartVersion([asking]);
    const keys: string[] = [];
    const shell = aProcess();
    const live = LiveAttempts.of({
      ...shell.live,
      attempt: (key, run) =>
        Effect.suspend(() => {
          keys.push(key);
          return shell.live.attempt(key, run);
        }),
    });
    const startOnce = (input: object, id: string) =>
      definitions.run(
        definitions
          .dispatch(
            startingAQuestion,
            toAlpha(thePlaybook, { type: 'asking', name: 'approve', version: 1, input, run_id: id }),
          )
          .pipe(Effect.provideService(LiveAttempts, live)),
      );
    const answeredLater = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71';
    const answeredNow = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72';

    const later = await startOnce({}, answeredLater);
    const now = await startOnce({ now: true }, answeredNow);

    expect([later, now]).toMatchObject([
      { status: 'succeeded', output: { status: 'started' } },
      { status: 'succeeded', output: { status: 'succeeded' } },
    ]);
    expect(keys).toEqual([`acme/alpha/${answeredNow}`]);
  });
});

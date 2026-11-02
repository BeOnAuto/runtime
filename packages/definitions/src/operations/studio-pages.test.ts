import { StudioLinks, type DispatcherServices, type Outcome, type StudioPage } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const { createDefinition, updateDefinition, runDefinition } = definitionOperationsFor([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function pageOf(page?: StudioPage): string {
  return `https://studio.example/${JSON.stringify(page)}`;
}

function linked(
  dispatched: Effect.Effect<Outcome, never, DispatcherServices>,
): Effect.Effect<Outcome, never, DispatcherServices> {
  return dispatched.pipe(Effect.provideService(StudioLinks, pageOf));
}

function asDispatched(
  dispatched: Effect.Effect<Outcome, never, DispatcherServices>,
): Effect.Effect<Outcome, never, DispatcherServices> {
  return dispatched;
}

const studioIn = Schema.decodeUnknownOption(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Struct({ studio: Schema.String }) }),
);

function studioOf(outcome: Outcome): string | undefined {
  return Option.getOrUndefined(Option.map(studioIn(outcome), ({ output }) => output.studio));
}

async function savedAndRun(served: typeof linked): Promise<readonly (string | undefined)[]> {
  const { dispatch, run } = harness();
  const created = await run(
    served(
      dispatch(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' })),
    ),
  );
  const updated = await run(
    served(
      dispatch(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' })),
    ),
  );
  const unchanged = await run(
    served(
      dispatch(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' })),
    ),
  );
  const ran = await run(
    served(dispatch(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: runId }))),
  );
  return [created, updated, unchanged, ran].map((outcome) => studioOf(outcome));
}

describe('the pages in Studio of what a playbook saves and runs', () => {
  it("are a definition's page at its version, saying whether it was created or updated and nothing where an update changed nothing, and a run's page", async () => {
    expect(await savedAndRun(linked)).toEqual([
      pageOf({ kind: 'definition', playbook: 'alpha', type: 'echo', name: 'greet', version: 1, saved: 'created' }),
      pageOf({ kind: 'definition', playbook: 'alpha', type: 'echo', name: 'greet', version: 2, saved: 'updated' }),
      pageOf({ kind: 'definition', playbook: 'alpha', type: 'echo', name: 'greet', version: 2 }),
      pageOf({ kind: 'run', playbook: 'alpha', run: runId }),
    ]);
  });

  it("are left out where the server serving the call does not know Studio's address", async () => {
    expect(await savedAndRun(asDispatched)).toEqual([undefined, undefined, undefined, undefined]);
  });
});

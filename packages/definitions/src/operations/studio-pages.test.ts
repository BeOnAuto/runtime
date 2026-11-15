import {
  StudioLinks,
  type DefinitionSaved,
  type DispatcherServices,
  type Outcome,
  type StudioPage,
} from '@on.auto/operations';
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

function greetAt(definition: string, version: number, saved?: DefinitionSaved): StudioPage {
  return {
    kind: 'definition',
    playbook: 'alpha',
    type: 'echo',
    name: 'greet',
    definition,
    version,
    ...(saved === undefined ? {} : { saved }),
  };
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

const definitionIdIn = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Struct({ definition_id: Schema.String }) }),
);

interface SavedAndRun {
  readonly definition: string;
  readonly links: readonly (string | undefined)[];
}

async function savedAndRun(served: typeof linked): Promise<SavedAndRun> {
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
  return {
    definition: definitionIdIn(created).output.definition_id,
    links: [created, updated, unchanged, ran].map((outcome) => studioOf(outcome)),
  };
}

describe('the pages in Studio of what a playbook saves and runs', () => {
  it("are a definition's page by the id it was created with, at its version, saying whether it was created or updated and nothing where an update changed nothing, and a run's page", async () => {
    const { definition, links } = await savedAndRun(linked);

    expect(links).toEqual([
      pageOf(greetAt(definition, 1, 'created')),
      pageOf(greetAt(definition, 2, 'updated')),
      pageOf(greetAt(definition, 2)),
      pageOf({ kind: 'run', playbook: 'alpha', run: runId }),
    ]);
  });

  it("are left out where the server serving the call does not know Studio's address", async () => {
    expect((await savedAndRun(asDispatched)).links).toEqual([undefined, undefined, undefined, undefined]);
  });
});

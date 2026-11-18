import { PlaybookContext, playbookLedgerOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { savedGoals, savedPage, savePlaybook } from '../exporting/playbook-saving.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { experiments } from './goal-examples.ts';
import { goalStandingIn } from './goals-stream.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const decodedWorkflow = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ steps: Schema.Number, contributes: Schema.optionalKey(Schema.Json) })),
);

const contributing: Capability = defineCapability({
  type: 'workflow',
  title: 'Workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It ran.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodedWorkflow(source)),
  summarize: ({ contributes }) => (contributes === undefined ? {} : { details: { contributes } }),
  run: () => Effect.succeed({ output: {}, record: {} }),
});

const decodedInteraction = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ answers: Schema.Boolean, calls: Schema.Boolean })),
);

const interacting: Capability = defineCapability({
  type: 'interaction',
  title: 'Interaction',
  guide: { name: 'interaction' },
  noun: { one: 'interaction function', other: 'interaction functions' },
  describeOutput: () => 'It was sent.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodedInteraction(source)),
  summarize: ({ answers, calls }) => ({
    ...(answers ? { outputSchema: { type: 'object' } } : {}),
    details: calls ? { call: { server: 'chat', tool: 'post' } } : { expires: 'PT1H' },
  }),
  run: () => Effect.succeed({ output: {}, record: {} }),
});

const kept = definitionOperationsFor([contributing, interacting], undefined, undefined, {
  goals: true,
  messages: true,
});

const notKept = definitionOperationsFor([contributing, interacting]);

const measuring = { goal: experiments.id, purpose: 'Measures each experiment.', per_id: '/id', measures: '/n' };

function standingOf(definitions: Harness) {
  return Effect.runPromise(
    goalStandingIn.pipe(
      Effect.provideService(PlaybookContext, { org: 'acme', playbook: 'alpha' }),
      Effect.provide(playbookLedgerOf(definitions.ledger.service, { org: 'acme', playbook: 'alpha' })),
    ),
  );
}

function saved(definitions: Harness, type: string, name: string, source: unknown) {
  const diagram = type === 'workflow' ? {} : { diagram: 'none' };
  return definitions.call(
    kept.createDefinition,
    toAlpha(acmeAdmin, { type, name, source: JSON.stringify(source), ...diagram }),
  );
}

async function standingAfterSaves() {
  const definitions = harness();
  await definitions.call(savePlaybook, toAlpha(acmeAdmin, { page: savedPage, goals: savedGoals }));
  const contributed = { steps: 1, contributes: [measuring] };
  await saved(definitions, 'workflow', 'measuring', contributed);
  await saved(definitions, 'workflow', 'resting', contributed);
  await saved(definitions, 'workflow', 'gone', contributed);

  await saved(definitions, 'interaction', 'tell-owner', { answers: false, calls: false });
  await saved(definitions, 'interaction', 'approve', { answers: true, calls: false });
  await saved(definitions, 'interaction', 'look-up', { answers: false, calls: true });
  await saved(definitions, 'interaction', 'old-note', { answers: false, calls: false });
  await definitions.call(
    notKept.createDefinition,
    toAlpha(acmeAdmin, { type: 'workflow', name: 'older', source: JSON.stringify({ steps: 1 }) }),
  );
  await definitions.call(kept.pauseDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'resting' }));
  await definitions.call(kept.retireDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'gone' }));
  await definitions.call(kept.retireDefinition, toAlpha(acmeAdmin, { type: 'interaction', name: 'old-note' }));
  return standingOf(definitions);
}

describe('what a playbook holds for its goals', () => {
  it('is nothing in a playbook that has saved nothing', async () => {
    expect(await standingOf(harness())).toEqual({ version: 0, goals: [], workflows: [], notifiers: new Set() });
  });

  it('is its goals, its workflows that are not retired with what they contribute, the notifications it can send, and when a workflow was last saved', async () => {
    const standing = await standingAfterSaves();

    expect(standing).toMatchObject({ version: 1, source: savedGoals, goals: [{ id: experiments.id }] });
    expect(standing.armedAt).toEqual(expect.any(Number));
    expect(standing.workflows).toEqual([
      { name: 'measuring', version: 1, paused: false, contributes: [measuring] },
      { name: 'resting', version: 1, paused: true, contributes: [measuring] },
      { name: 'older', version: 1, paused: false, contributes: [] },
    ]);
    expect(standing.notifiers).toEqual(new Set(['tell-owner']));
  });
});

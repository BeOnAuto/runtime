import { Ledger, PlaybookContext, playbookLedgerOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { savedGoals, savedPage, savePlaybook } from '../exporting/playbook-saving.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness, type LedgerRead } from '../testing/harness.ts';
import { experiments } from './goal-examples.ts';
import { goalStandingIn } from './playbook-goals.ts';

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
  await savesOf(definitions);
  return standingOf(definitions);
}

async function savesOf(definitions: Harness) {
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
}

describe('what a playbook holds for its goals', () => {
  it('is nothing in a playbook that has saved nothing', async () => {
    expect(await standingOf(harness())).toEqual({ goals: [], held: [], workflows: [], notifiers: new Set() });
  });

  it('is its goals, its workflows that are not retired with what they contribute, the notifications it can send, and when a workflow was last saved', async () => {
    const standing = await standingAfterSaves();

    expect(standing).toMatchObject({ source: savedGoals, goals: [{ id: experiments.id }], held: [{ version: 1 }] });
    expect(standing.armedAt).toEqual(expect.any(Number));
    expect(standing.workflows).toEqual([
      { name: 'measuring', version: 1, paused: false, contributes: [measuring] },
      { name: 'resting', version: 1, paused: true, contributes: [measuring] },
      { name: 'older', version: 1, paused: false, contributes: [] },
    ]);
    expect(standing.notifiers).toEqual(new Set(['tell-owner']));
  });
});

function withoutIds(standing: Awaited<ReturnType<typeof standingOf>>) {
  return { ...standing, held: standing.held.map((held) => ({ ...held, definition: '' })) };
}

function withTheReadModelRefusing(ledger: Ledger['Service']): Ledger['Service'] {
  return { ...ledger, readProjectedRows: () => Effect.die(new Error('The read model cannot be read')) };
}

function interactionsFoldedIn(reads: readonly LedgerRead[]): readonly LedgerRead[] {
  return reads.filter((read) => 'loaded' in read && read.loaded.endsWith('/definitions/interaction'));
}

function standingReadOf(definitions: Harness, readThrough: (ledger: Ledger['Service']) => Ledger['Service']) {
  return definitions.run(
    Effect.flatMap(Effect.service(Ledger), (ledger) =>
      goalStandingIn.pipe(
        Effect.provideService(PlaybookContext, { org: 'acme', playbook: 'alpha' }),
        Effect.provide(playbookLedgerOf(readThrough(ledger), { org: 'acme', playbook: 'alpha' })),
      ),
    ),
  );
}

describe('what a playbook holds for its goals where the definitions read model answers', () => {
  it.each(['reads', 'on'] as const)(
    'is read of the read model at the stage %s, folding the stream of no interaction, and is what the folds answer',
    async (stage) => {
      const folded = await standingAfterSaves();
      const definitions = harness(undefined, undefined, { stage, folds: ['workflow', 'interaction'] });
      await savesOf(definitions);
      const before = definitions.ledgerReads().length;

      const standing = await standingReadOf(definitions, (ledger) => ledger);
      const interactionsFolded = interactionsFoldedIn(definitions.ledgerReads().slice(before));

      expect(withoutIds(standing)).toEqual(withoutIds(folded));
      expect(interactionsFolded).toEqual([]);
    },
  );

  it('is folded as before where the read model cannot be read', async () => {
    const folded = await standingAfterSaves();
    const definitions = harness(undefined, undefined, { stage: 'on', folds: ['workflow', 'interaction'] });
    await savesOf(definitions);
    const before = definitions.ledgerReads().length;

    const standing = await standingReadOf(definitions, withTheReadModelRefusing);

    expect(withoutIds(standing)).toEqual(withoutIds(folded));
    expect(interactionsFoldedIn(definitions.ledgerReads().slice(before))).toHaveLength(4);
  });
});

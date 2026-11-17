import { PlaybookContext, playbookLedgerOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { savedGoals, savedPage, savePlaybook } from '../exporting/playbook-saving.ts';
import { experiments } from '../goals/goal-examples.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { goalsSaveNoticesIn } from './setup-notices-in.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const decodedWorkflow = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      contributes: Schema.optionalKey(Schema.Json),
      every: Schema.optionalKey(Schema.Number),
      asks: Schema.optionalKey(Schema.String),
    }),
  ),
);

const contributing: Capability = defineCapability({
  type: 'workflow',
  title: 'Workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It ran.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodedWorkflow(source)),
  summarize: ({ contributes, every, asks }) => ({
    details: {
      ...(contributes === undefined ? {} : { contributes }),
      ...(asks === undefined
        ? {}
        : { calls: [{ type: 'interaction', name: asks, steps: [{ number: 1, name: 'ask' }] }] }),
    },
    ...(every === undefined ? {} : { triggers: [{ kind: 'every', reference: '/schedule', milliseconds: every }] }),
  }),
  run: () => Effect.succeed({ output: {}, record: {} }),
});

const decodedInteraction = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ answers: Schema.Boolean })),
);

const interacting: Capability = defineCapability({
  type: 'interaction',
  title: 'Interaction',
  guide: { name: 'interaction' },
  noun: { one: 'interaction function', other: 'interaction functions' },
  describeOutput: () => 'It was sent.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodedInteraction(source)),
  summarize: ({ answers }) => ({ ...(answers ? { outputSchema: { type: 'object' } } : {}), details: {} }),
  run: () => Effect.succeed({ output: {}, record: {} }),
});

const kept = definitionOperationsFor([contributing, interacting], undefined, undefined, {
  goals: true,
  messages: true,
});

const notKept = definitionOperationsFor([contributing, interacting]);

function noticesOf(definitions: Harness) {
  return Effect.runPromise(
    goalsSaveNoticesIn.pipe(
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

async function withGoals(): Promise<Harness> {
  const definitions = harness();
  await definitions.call(savePlaybook, toAlpha(acmeAdmin, { page: savedPage, goals: savedGoals }));
  await saved(definitions, 'interaction', 'ask-owner', { answers: true });
  await saved(definitions, 'interaction', 'tell-owner', { answers: false });
  return definitions;
}

const choosing = { goal: experiments.id, purpose: 'Asks which idea.', per_id: '/id', title: '/title', marks: 'chosen' };

const watching = {
  goal: experiments.id,
  purpose: 'Sees it go live.',
  per_id: '/id',
  marks: 'live',
  measures: '/customers',
  says: '/evidence',
};

describe('the notices of a goals save, read from what the playbook holds', () => {
  it('reminds of every milestone the person does while no workflow asks them, and drops one once a workflow that asks marks it', async () => {
    const definitions = await withGoals();
    const before = await noticesOf(definitions);
    await saved(definitions, 'workflow', 'choose-idea', { contributes: [choosing], asks: 'ask-owner' });

    expect(before.map(({ detail }) => detail.slice(0, 60))).toEqual([
      '"Idea chosen", "Taken live", and "Lesson kept" of the goal p',
    ]);
    expect((await noticesOf(definitions)).map(({ detail }) => detail.slice(0, 40))).toEqual([
      '"Taken live" and "Lesson kept" of the go',
    ]);
  });

  it('counts a workflow that only sends a message, or calls a retired request, as asking nothing, and leaves out retired workflows and one saved before goals', async () => {
    const definitions = await withGoals();
    await saved(definitions, 'workflow', 'tell', { contributes: [choosing], asks: 'tell-owner' });
    await saved(definitions, 'workflow', 'asked-before', { contributes: [choosing], asks: 'ask-owner' });
    await definitions.call(kept.retireDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'asked-before' }));
    await saved(definitions, 'interaction', 'ask-gone', { answers: true });
    await definitions.call(kept.retireDefinition, toAlpha(acmeAdmin, { type: 'interaction', name: 'ask-gone' }));
    await saved(definitions, 'workflow', 'asks-of-a-retired', { contributes: [choosing], asks: 'ask-gone' });
    const older = await definitions.call(
      notKept.createDefinition,
      toAlpha(acmeAdmin, { type: 'workflow', name: 'older', source: JSON.stringify({ asks: 'ask-owner' }) }),
    );

    expect(older).toMatchObject({ status: 'succeeded' });
    expect((await noticesOf(definitions)).map(({ detail }) => detail.slice(0, 14))).toEqual(['"Idea chosen",']);
  });
});

describe('a workflow saved where goals are kept', () => {
  it('answers with the notices of what the person will see, beside the save', async () => {
    const definitions = await withGoals();
    const answer = await saved(definitions, 'workflow', 'watch', { contributes: [watching], every: 60_000 });

    expect(answer).toMatchObject({
      status: 'succeeded',
      output: {
        notices: [{ kind: 'judged_too_often' }, { kind: 'person_milestone_unasked' }],
        before_going_on:
          'Two things to double-check are in notices: if you are sure of what you did, carry on and tell the person in one sentence why you kept them; if not, now is a good time to fix them.',
      },
    });
  });
});

import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { savedPage, savePlaybook } from '../exporting/playbook-saving.ts';
import { controls, experiments, oneOff, textOf } from '../goals/goal-examples.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { contributesWantedWords, contributionsMisfitWords, goalsWantedAtSaveWordsOf } from './contribution-words.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const decodedDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ steps: Schema.Number, contributes: Schema.optionalKey(Schema.Json) })),
);

const contributing: Capability = defineCapability({
  type: 'workflow',
  title: 'Workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It ran.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodedDocument(source)),
  summarize: ({ contributes }) => (contributes === undefined ? {} : { details: { contributes } }),
  run: () => Effect.succeed({ output: {}, record: {} }),
});

const kept = definitionOperationsFor([contributing, echo], undefined, undefined, { goals: true, messages: true });

const keptUntold = definitionOperationsFor([contributing, echo], undefined, undefined, {
  goals: true,
  messages: false,
});

const notKept = definitionOperationsFor([contributing, echo]);

const retiredControls = { ...controls, id: 'old-controls', retired: true };

const heldGoals = textOf([experiments, controls, oneOff, retiredControls]);

const measuring = {
  goal: experiments.id,
  purpose: 'Measures what each experiment brought in.',
  per_id: '/id',
  marks: 'measured',
  measures: '/customers',
  final: '/closed',
};

const sourceOf = (contributes?: unknown) =>
  JSON.stringify(contributes === undefined ? { steps: 1 } : { steps: 1, contributes });

async function playbookWithGoals(): Promise<Harness> {
  const definitions = harness();
  await definitions.call(savePlaybook, toAlpha(acmeAdmin, { page: savedPage, goals: heldGoals }));
  return definitions;
}

const served = { kept, keptUntold, notKept };

function created(definitions: Harness, where: keyof typeof served, input: Readonly<Record<string, string>>) {
  return definitions.call(served[where].createDefinition, toAlpha(acmeAdmin, input));
}

function updated(definitions: Harness, input: Readonly<Record<string, string>>) {
  return definitions.call(kept.updateDefinition, toAlpha(acmeAdmin, input));
}

function refusalOf(
  issues: readonly Readonly<{ pointer: string; detail: string }>[],
  detail = contributionsMisfitWords,
) {
  return { status: 'rejected', reason: 'invalid_input', detail, issues };
}

const askedForGoals = refusalOf(
  [{ pointer: '', detail: goalsWantedAtSaveWordsOf(true) }],
  goalsWantedAtSaveWordsOf(true),
);

const workflowNamed = (name: string, contributes?: unknown) => ({
  type: 'workflow',
  name,
  source: sourceOf(contributes),
});

describe('a workflow saved where goals are kept, in a playbook that has none', () => {
  it('is refused, created or updated, with the person’s first question and where the answer goes, and writes nothing', async () => {
    const definitions = harness();
    const first = await created(definitions, 'notKept', workflowNamed('older'));

    const refusals = [
      await created(definitions, 'kept', workflowNamed('newer', [measuring])),
      await updated(definitions, workflowNamed('older', [measuring])),
    ];

    expect(first).toMatchObject({ status: 'succeeded' });
    expect(refusals).toEqual([askedForGoals, askedForGoals]);
    expect(goalsWantedAtSaveWordsOf(true)).toMatch(
      /^Ask the person: What should this playbook achieve for you, and how will you know it worked\? .*goals argument of update_playbook, as the goals guide says/u,
    );
    expect(await definitions.call(kept.listDefinitions, toAlpha(acmeAdmin, { type: 'workflow' }))).toMatchObject({
      output: { definitions: [{ name: 'older', version: 1 }] },
    });
  });

  it('asks nothing about being told where messages are off', async () => {
    const definitions = harness();
    const untold = goalsWantedAtSaveWordsOf(false);

    expect(await created(definitions, 'keptUntold', workflowNamed('newer', [measuring]))).toEqual(
      refusalOf([{ pointer: '', detail: untold }], untold),
    );
    expect(untold).not.toMatch(/\btell\b|\btold\b/u);
  });

  it('leaves a function saved as before, and a restore of an older workflow is not refused', async () => {
    const definitions = harness();
    await created(definitions, 'notKept', workflowNamed('older'));
    await definitions.call(notKept.retireDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'older' }));

    expect(
      await created(definitions, 'kept', { type: 'echo', name: 'greeter', source: '{"greeting": "Hello"}' }),
    ).toMatchObject({ status: 'succeeded' });
    expect(
      await definitions.call(kept.restoreDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'older' })),
    ).toMatchObject({ status: 'succeeded' });
  });

  it('is saved as before where goals are not kept', async () => {
    expect(await created(harness(), 'notKept', workflowNamed('plain'))).toMatchObject({ status: 'succeeded' });
  });
});

describe('a workflow saved where goals are kept, in a playbook that has them', () => {
  it('is refused without contributes, or with an empty list of them, the agent’s to fix under the source', async () => {
    const definitions = await playbookWithGoals();
    const wanted = refusalOf([{ pointer: '/source', detail: contributesWantedWords }], contributesWantedWords);

    expect([
      await created(definitions, 'kept', workflowNamed('silent')),
      await created(definitions, 'kept', workflowNamed('empty', [])),
    ]).toEqual([wanted, wanted]);
  });

  it('is saved with contributions that fit the goals, and updated with them', async () => {
    const definitions = await playbookWithGoals();
    const daily = { goal: controls.id, purpose: 'Counts the failing controls.', measures: '/failed', final: true };
    const oneTime = { goal: oneOff.id, purpose: 'Counts the paying customers.', measures: '/paid', as_of: '/at' };

    const saved = await created(definitions, 'kept', workflowNamed('measuring', [measuring]));
    const again = await updated(definitions, workflowNamed('measuring', [measuring, daily, oneTime]));

    expect(saved).toMatchObject({ status: 'succeeded', output: { details: { contributes: [measuring] } } });
    expect(again).toMatchObject({ status: 'succeeded', output: { version: 2 } });
  });
});

const purpose = 'Does something for the goal.';

const misfits = [
  { goal: 'no-such-goal', purpose },
  { goal: retiredControls.id, purpose },
  { goal: experiments.id, purpose, per_id: '/id', marks: 'shipped' },
  { goal: experiments.id, purpose },
  { goal: controls.id, purpose, each: '/items', marks: 'checked' },
  { goal: controls.id, purpose, final: true, as_of: '/at' },
  { goal: oneOff.id, purpose, measures: '/paid', final: '/closed' },
];

function issueAt(place: string, detail: string) {
  return { pointer: `/source/contributes/${place}`, detail };
}

const misfitIssues = [
  issueAt(
    '0/goal',
    `The playbook has no goal no-such-goal; name one of its goals: ${experiments.id}, ${controls.id}, ${oneOff.id}`,
  ),
  issueAt(
    '1/goal',
    `The goal ${retiredControls.id} is retired, so a workflow no longer contributes to it; name a goal that is not retired`,
  ),
  issueAt(
    '2/marks',
    `The goal ${experiments.id} has no milestone shipped; mark one of its milestones: chosen, prepared, live, measured, concluded`,
  ),
  issueAt(
    '3',
    `The goal ${experiments.id} is judged one experiment at a time, so give per_id, a pointer to the id of the experiment in the output`,
  ),
  issueAt('4/each', `The goal ${controls.id} is judged as a whole, not one thing at a time, so leave each out`),
  issueAt('4/marks', `The goal ${controls.id} names no milestones, so leave marks out`),
  issueAt('5/final', 'final says the measure will not change any more, so it needs measures beside it'),
  issueAt('5/as_of', 'as_of says when the measure was true, so it needs measures beside it'),
  issueAt('6/final', `The goal ${oneOff.id} has no window, so its measure is never final; leave final out`),
];

describe('a workflow whose contributions do not fit the goals of its playbook', () => {
  it('is refused for each entry that does not fit, each under its own pointer, and is not saved', async () => {
    const definitions = await playbookWithGoals();

    const refused = await created(definitions, 'kept', workflowNamed('misfit', misfits));

    expect(refused).toEqual(refusalOf(misfitIssues));
    expect(await definitions.call(kept.listDefinitions, toAlpha(acmeAdmin, { type: 'workflow' }))).toMatchObject({
      output: { definitions: [] },
    });
  });
});

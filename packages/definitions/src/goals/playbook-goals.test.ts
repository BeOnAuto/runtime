import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { changedMeanwhile } from '../registry/registry-decisions.ts';
import { goalsBook, goalsDocumentOfTheExamples as documentOf } from '../testing/goals-book.ts';
import { changed, controls, experimentSuccess, experiments, oneOff, textOf } from './goal-examples.ts';
import { goalsDocumentOf } from './goals-check.ts';
import { goalsSourceOf } from './goals-document.ts';
import { playbookGoalsSaved, type GoalsSave } from './goals-saved.ts';
import { goalVersionIn, heldGoalNamed, heldGoalOfIdentity, playbookGoalsIn } from './playbook-goals.ts';

const someWords: unknown = expect.any(String);

const none: ReadonlySet<string> = new Set();

const inAlpha = 'playbook/acme/alpha/';

function inThePlaybook() {
  const book = goalsBook();
  return {
    ...book,
    saving: (save: GoalsSave) => book.as()(playbookGoalsSaved(save)),
    reading: async () => Result.getOrThrow(await book.as()(playbookGoalsIn)),
    namesHeld: () => book.goalNames().map(({ playbookKey, name, status }) => ({ playbookKey, name, status }) as const),
  };
}

describe('the goals of a playbook, each a record of its own', () => {
  it('are none until saved, then each goal is held under an id of its own and read in the order of the list', async () => {
    const book = inThePlaybook();
    const document = documentOf([experiments, controls]);

    expect(await book.reading()).toEqual({ goals: [], held: [] });
    expect(await book.saving({ document, assessed: none })).toEqual(Result.succeed({ outcome: 'saved' }));
    const read = await book.reading();

    expect([read.goals, read.source]).toEqual([document.goals, goalsSourceOf(document.goals)]);
    expect(read.held.map(({ definition, version, goal }) => [definition, version, goal.id])).toEqual([
      [book.idOf(experiments.id), 1, experiments.id],
      [book.idOf(controls.id), 1, controls.id],
    ]);
    expect(book.idOf(experiments.id)).not.toBe(book.idOf(controls.id));
    expect(book.namesHeld()).toHaveLength(2);
    expect(book.namesHeld()).toEqual(
      expect.arrayContaining(
        [experiments.id, controls.id].map((name) => ({ playbookKey: inAlpha, name, status: 'active' })),
      ),
    );
  });
});

describe('the record of a goal saved', () => {
  it('holds goal_created on the goal own stream with the playbook, its place and the goal, its id and who saved it in the context', async () => {
    const book = inThePlaybook();
    const document = documentOf([experiments, controls]);
    await book.saving({ document, assessed: none });

    const facts = await book.factsOf(controls.id);

    expect(facts.map(({ type, data, context }) => ({ type, data, context }))).toEqual([
      {
        type: 'goal_created',
        data: { playbook: 'alpha', position: 1, goal: document.goals[1] },
        context: { at: someWords, by: 'acme-admin', definitionId: book.idOf(controls.id) },
      },
    ]);
  });

  it('appends nothing for the same goals saved again, whatever text surrounds them, and writes the text out from the goals held', async () => {
    const book = inThePlaybook();
    const document = documentOf([experiments]);
    await book.saving({ document, assessed: none });
    const commented = Result.getOrThrow(goalsDocumentOf(`# The goals\n${textOf([experiments])}`));

    expect(await book.saving({ document: commented, assessed: none })).toEqual(
      Result.succeed({ outcome: 'unchanged' }),
    );
    expect((await book.factsOf(experiments.id)).length).toBe(1);
    expect((await book.reading()).source).toBe(goalsSourceOf(document.goals));
  });
});

describe('a goal saved again', () => {
  it('is recorded as goal_updated at a new version when it changed, and as goal_reordered at its version in a new place', async () => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([experiments, controls]), assessed: none });
    const restated = changed(controls, ['statement'], 'Every control holds.');

    await book.saving({ document: documentOf([restated, experiments]), assessed: none });
    const read = await book.reading();

    const facts = await book.factsOf(controls.id);

    expect(facts.map(({ type }) => type)).toEqual(['goal_created', 'goal_updated', 'goal_reordered']);
    expect(facts.slice(1).map(({ data }) => data)).toEqual([
      { goal: documentOf([restated]).goals[0] },
      { position: 0 },
    ]);
    expect((await book.factsOf(experiments.id)).map(({ type }) => type)).toEqual(['goal_created', 'goal_reordered']);
    expect(read.goals.map(({ id }) => id)).toEqual([controls.id, experiments.id]);
    expect([controls.id, experiments.id, oneOff.id].map((id) => goalVersionIn(read, id))).toEqual([2, 1, 0]);
    expect(heldGoalNamed(read, oneOff.id)).toBeUndefined();
  });

  it('is found by its identity, the key its results are kept under, whatever it is named', async () => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([experiments, controls]), assessed: none });
    const read = await book.reading();
    const held = heldGoalNamed(read, controls.id);

    expect(heldGoalOfIdentity(read, held?.definition)).toEqual(held);
    expect([heldGoalOfIdentity(read, 'no-such-goal'), heldGoalOfIdentity(read)]).toEqual([undefined, undefined]);
  });
});

describe('the whole list of goals', () => {
  it('removes a goal left out that was never judged and frees its id, which a later goal takes under an id of its own', async () => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([experiments, controls]), assessed: none });
    const first = book.idOf(experiments.id);

    expect(await book.saving({ document: documentOf([controls]), assessed: new Set([controls.id]) })).toEqual(
      Result.succeed({ outcome: 'saved' }),
    );
    expect((await book.factsOfTheGoal(first)).map(({ type }) => type)).toEqual(['goal_created', 'goal_removed']);
    expect(book.namesHeld().map(({ name }) => name)).toEqual([controls.id]);

    await book.saving({ document: documentOf([controls, experiments]), assessed: none });

    expect(book.idOf(experiments.id)).not.toBe(first);
    expect((await book.reading()).goals.map(({ id }) => id)).toEqual([controls.id, experiments.id]);
  });

  it('refuses the whole save when it leaves out a goal that has been judged, which is kept by retiring it', async () => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([experiments, controls]), assessed: none });
    const assessed = new Set([controls.id]);

    expect(await book.saving({ document: documentOf([oneOff, experiments]), assessed })).toEqual(
      Result.fail(
        expect.objectContaining({
          _tag: 'invalid_input',
          detail: 'These goals cannot replace the goals saved before',
          issues: [{ pointer: '', detail: someWords }],
        }),
      ),
    );
    expect((await book.reading()).goals.map(({ id }) => id)).toEqual([experiments.id, controls.id]);

    await book.saving({ document: documentOf([experiments, { ...controls, retired: true }]), assessed });

    expect(book.namesHeld().find(({ name }) => name === controls.id)?.status).toBe('retired');
    expect(goalVersionIn(await book.reading(), controls.id)).toBe(2);
  });

  it('brings a retired goal back when it is saved without retired', async () => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([{ ...controls, retired: true }]), assessed: none });
    await book.saving({ document: documentOf([controls]), assessed: new Set([controls.id]) });

    expect(book.namesHeld()).toEqual([{ playbookKey: inAlpha, name: controls.id, status: 'active' }]);
  });
});

const reshaped: readonly (readonly [string, unknown, string])[] = [
  ['what it is judged per', { ...experiments, per: 'invoice' }, '/1/per'],
  ['what it is judged per, by dropping it', { ...experiments, per: undefined }, '/1/per'],
  ['the kind of its window', { ...experiments, window: undefined }, '/1/window'],
  ['how it settles', { ...experiments, success: { ...experimentSuccess, settles: 'at_close' } }, '/1/success/settles'],
];

const recalendared: readonly (readonly [string, unknown, string])[] = [
  ['the unit of its calendar window', { calendar: 'week' }, '/0/window/calendar'],
  [
    'the time zone of its calendar window',
    { calendar: 'day', time_zone: 'America/Los_Angeles' },
    '/0/window/time_zone',
  ],
];

describe('the shape of a goal under its id', () => {
  it.each(reshaped)('cannot change %s, pointed at by its place in the list', async (_, goal, pointer) => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([experiments]), assessed: none });

    expect(await book.saving({ document: documentOf([oneOff, goal]), assessed: none })).toEqual(
      Result.fail(expect.objectContaining({ _tag: 'invalid_input', issues: [{ pointer, detail: someWords }] })),
    );
    expect(book.namesHeld().map(({ name }) => name)).toEqual([experiments.id]);
  });
});

describe('the calendar of a goal under its id', () => {
  it.each(recalendared)('cannot change %s', async (_, window, pointer) => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([controls]), assessed: none });

    expect(await book.saving({ document: documentOf([{ ...controls, window }]), assessed: none })).toMatchObject(
      Result.fail({ issues: [{ pointer }] }),
    );
  });

  it('keeps the shape of a retired goal, and frees the id of a goal that was left out', async () => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([{ ...controls, retired: true }, experiments]), assessed: none });
    const reCalendared = { ...controls, retired: true, window: { calendar: 'week' } };

    expect(await book.saving({ document: documentOf([reCalendared, experiments]), assessed: none })).toMatchObject(
      Result.fail({ issues: [{ pointer: '/0/window/calendar' }] }),
    );
    await book.saving({ document: documentOf([experiments]), assessed: none });
    expect(await book.saving({ document: documentOf([experiments, reCalendared]), assessed: none })).toMatchObject(
      Result.succeed({ outcome: 'saved' }),
    );
  });

  it('lets everything else change, and takes the default time zone written out as unchanged', async () => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([controls, experiments]), assessed: none });
    const edited = [
      { ...controls, window: { calendar: 'day', time_zone: 'UTC', grace: 'PT2H' }, statement: 'Every control holds.' },
      {
        ...experiments,
        window: { after: 'chosen', for: 'P3D' },
        success: { ...experimentSuccess, target: { at_most: 3 } },
      },
    ];

    expect(await book.saving({ document: documentOf(edited), assessed: none })).toMatchObject(
      Result.succeed({ outcome: 'saved' }),
    );
  });
});

describe('saving goals only where there are none', () => {
  it('saves the first goals, and leaves goals already held as they are, so a repeated repair writes once', async () => {
    const book = inThePlaybook();
    const document = documentOf([experiments]);

    expect(await book.saving({ document, assessed: none, onlyIfNone: true })).toEqual(
      Result.succeed({ outcome: 'saved' }),
    );
    expect(await book.saving({ document: documentOf([controls]), assessed: none, onlyIfNone: true })).toEqual(
      Result.succeed({ outcome: 'already_held' }),
    );
    expect((await book.reading()).goals).toEqual(document.goals);
  });
});

describe('two saves of the goals at once', () => {
  it('keep each other change where they change different goals, where a save of one whole list replaced the other before', async () => {
    const book = inThePlaybook();
    await book.saving({ document: documentOf([experiments, controls]), assessed: none });
    const restatedExperiments = changed(experiments, ['statement'], 'Bring in customers through every experiment.');
    const restatedControls = changed(controls, ['statement'], 'Every control holds.');

    const saved = await Promise.all([
      book.saving({ document: documentOf([restatedExperiments, controls]), assessed: none }),
      book.saving({ document: documentOf([experiments, restatedControls]), assessed: none }),
    ]);

    expect(saved).toEqual([Result.succeed({ outcome: 'saved' }), Result.succeed({ outcome: 'saved' })]);
    expect((await book.reading()).goals).toEqual(documentOf([restatedExperiments, restatedControls]).goals);
  });

  it('refuse the one that creates a goal the other created first, as changed meanwhile, which a call again saves', async () => {
    const book = inThePlaybook();

    const saved = await Promise.all([
      book.saving({ document: documentOf([experiments]), assessed: none }),
      book.saving({ document: documentOf([experiments, controls]), assessed: none }),
    ]);

    expect(saved).toEqual([Result.succeed({ outcome: 'saved' }), Result.fail(changedMeanwhile)]);
    expect(await book.saving({ document: documentOf([experiments, controls]), assessed: none })).toEqual(
      Result.succeed({ outcome: 'saved' }),
    );
  });
});

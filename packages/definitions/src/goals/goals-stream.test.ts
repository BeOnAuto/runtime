import { Caller, playbookLedgerOf } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, savedIn } from '../testing/callers.ts';
import { controls, experimentSuccess, experiments, textOf } from './goal-examples.ts';
import { goalsDocumentOf } from './goals-check.ts';
import type { GoalsDocument } from './goals-document.ts';
import { GoalsEventSchema, type RecordedGoalsEvent } from './goals-facts.ts';
import {
  goalsStream,
  playbookGoalsIn,
  playbookGoalsSaved,
  retiredGoalIds,
  type GoalsSave,
  type PlaybookGoals,
  type SavedGoals,
} from './goals-stream.ts';

function documentOf(goals: readonly unknown[]): GoalsDocument {
  return Result.getOrThrow(goalsDocumentOf(textOf(goals)));
}

function resultOf<E>(effect: Effect.Effect<SavedGoals, E>): Promise<Result.Result<SavedGoals, E>> {
  return Effect.runPromise(Effect.result(effect));
}

const factsFold = {
  initialState: [],
  evolve: (seen: readonly RecordedGoalsEvent[], fact: RecordedGoalsEvent) => [...seen, fact],
  eventSchema: GoalsEventSchema,
};

function inThePlaybook() {
  const ledger = memoryLedger().service;
  const context = playbookLedgerOf(ledger, savedIn);
  return {
    saving: (save: GoalsSave) =>
      resultOf(playbookGoalsSaved(save).pipe(Effect.provideService(Caller, acmeAdmin), Effect.provide(context))),
    reading: () => Effect.runPromise(playbookGoalsIn.pipe(Effect.provide(context))),
    facts: () =>
      Effect.runPromise(ledger.load(`playbook/${savedIn.org}/${savedIn.playbook}/${goalsStream}`, factsFold)),
  };
}

const none: ReadonlySet<string> = new Set();

const nothingYet: PlaybookGoals = { version: 0, goals: [] };

describe('saving the goals of a playbook', () => {
  it('has none until they are saved, and counts its versions up from the first save', async () => {
    const { saving, reading } = inThePlaybook();
    const first = documentOf([experiments]);
    const second = documentOf([experiments, controls]);

    expect(await reading()).toEqual(nothingYet);
    expect(await saving({ document: first, assessed: none })).toEqual(
      Result.succeed({ goals: { version: 1, ...first }, outcome: 'saved' }),
    );
    expect(await saving({ document: second, assessed: none })).toEqual(
      Result.succeed({ goals: { version: 2, ...second }, outcome: 'saved' }),
    );
    expect(await reading()).toEqual({ version: 2, ...second });
  });

  it('records one fact with the source, the decoded goals, the version and who saved them', async () => {
    const { saving, facts } = inThePlaybook();
    const document = documentOf([experiments]);
    await saving({ document, assessed: none });

    const { state } = await facts();

    expect(state.map(({ type, data }) => ({ type, data }))).toEqual([
      { type: 'playbook_goals_saved', data: { source: document.source, goals: document.goals, version: 1 } },
    ]);
    expect(state.map(({ context }) => context.by)).toEqual([acmeAdmin.id]);
  });

  it('appends nothing for the same document saved again', async () => {
    const { saving, facts } = inThePlaybook();
    const document = documentOf([experiments]);
    await saving({ document, assessed: none });

    expect(await saving({ document, assessed: none })).toEqual(
      Result.succeed({ goals: { version: 1, ...document }, outcome: 'unchanged' }),
    );
    expect((await facts()).version).toBe(1);
  });
});

describe('the whole list of goals', () => {
  it('may leave out a goal that was never judged', async () => {
    const { saving } = inThePlaybook();
    await saving({ document: documentOf([experiments, controls]), assessed: none });

    expect(await saving({ document: documentOf([controls]), assessed: new Set(['controls-hold']) })).toMatchObject(
      Result.succeed({ goals: { version: 2 }, outcome: 'saved' }),
    );
  });

  it('may not leave out a goal that has been judged, which is kept by retiring it', async () => {
    const { saving, reading } = inThePlaybook();
    await saving({ document: documentOf([experiments, controls]), assessed: none });
    const assessed = new Set(['controls-hold']);

    expect(await saving({ document: documentOf([experiments]), assessed })).toMatchObject(
      Result.fail({
        _tag: 'invalid_input',
        detail: 'These goals cannot replace the goals saved before',
        issues: [
          {
            pointer: '',
            detail:
              'The goal controls-hold has been judged and cannot be left out; keep it in the list with retired set to true',
          },
        ],
      }),
    );
    expect((await reading()).version).toBe(1);
    await saving({ document: documentOf([experiments, { ...controls, retired: true }]), assessed });
    expect(retiredGoalIds((await reading()).goals)).toEqual(['controls-hold']);
  });

  it('brings a retired goal back when it is saved without retired', async () => {
    const { saving, reading } = inThePlaybook();
    await saving({ document: documentOf([{ ...controls, retired: true }]), assessed: none });
    await saving({ document: documentOf([controls]), assessed: new Set(['controls-hold']) });

    expect(retiredGoalIds((await reading()).goals)).toEqual([]);
  });
});

const reshaped: readonly (readonly [string, unknown, string])[] = [
  ['what it is judged per', { ...experiments, per: 'invoice' }, '/0/per'],
  ['what it is judged per, by dropping it', { ...experiments, per: undefined }, '/0/per'],
  ['the kind of its window', { ...experiments, window: undefined }, '/0/window'],
  ['how it settles', { ...experiments, success: { ...experimentSuccess, settles: 'at_close' } }, '/0/success/settles'],
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
  it.each(reshaped)('cannot change %s', async (_, goal, pointer) => {
    const { saving } = inThePlaybook();
    await saving({ document: documentOf([experiments]), assessed: none });

    expect(await saving({ document: documentOf([goal]), assessed: none })).toMatchObject(
      Result.fail({ _tag: 'invalid_input', issues: [{ pointer }] }),
    );
  });

  it.each(recalendared)('cannot change %s', async (_, window, pointer) => {
    const { saving } = inThePlaybook();
    await saving({ document: documentOf([controls]), assessed: none });

    expect(await saving({ document: documentOf([{ ...controls, window }]), assessed: none })).toMatchObject(
      Result.fail({ issues: [{ pointer }] }),
    );
  });

  it('keeps the shape of a retired goal, and frees the id of a goal that was left out', async () => {
    const { saving } = inThePlaybook();
    await saving({ document: documentOf([{ ...controls, retired: true }, experiments]), assessed: none });
    const reCalendared = { ...controls, retired: true, window: { calendar: 'week' } };

    expect(await saving({ document: documentOf([reCalendared, experiments]), assessed: none })).toMatchObject(
      Result.fail({ issues: [{ pointer: '/0/window/calendar' }] }),
    );
    await saving({ document: documentOf([experiments]), assessed: none });
    expect(await saving({ document: documentOf([experiments, reCalendared]), assessed: none })).toMatchObject(
      Result.succeed({ outcome: 'saved' }),
    );
  });

  it('lets everything else change, and takes the default time zone written out as unchanged', async () => {
    const { saving } = inThePlaybook();
    await saving({ document: documentOf([controls, experiments]), assessed: none });
    const edited = [
      { ...controls, window: { calendar: 'day', time_zone: 'UTC', grace: 'PT2H' }, statement: 'Every control holds.' },
      {
        ...experiments,
        window: { after: 'chosen', for: 'P3D' },
        success: { ...experimentSuccess, target: { at_most: 3 } },
      },
    ];

    expect(await saving({ document: documentOf(edited), assessed: none })).toMatchObject(
      Result.succeed({ outcome: 'saved' }),
    );
  });
});

describe('saving goals only where there are none', () => {
  it('saves the first goals, and leaves goals already held as they are, so a repeated repair writes once', async () => {
    const { saving, facts } = inThePlaybook();
    const document = documentOf([experiments]);

    expect(await saving({ document, assessed: none, onlyIfNone: true })).toMatchObject(
      Result.succeed({ outcome: 'saved' }),
    );
    expect(await saving({ document: documentOf([controls]), assessed: none, onlyIfNone: true })).toEqual(
      Result.succeed({ goals: { version: 1, ...document }, outcome: 'already_held' }),
    );
    expect((await facts()).version).toBe(1);
  });
});

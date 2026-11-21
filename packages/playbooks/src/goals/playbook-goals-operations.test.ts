import { makeCatalog, type RouteRegistration } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { createPlaybook, mostGoalsBytes, playbookOperationsOf } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { goalsInMemory, noGoalGap } from '../testing/goals-in-memory.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';
import { createdWithGoals, goalsText, versionsOfBothAt } from '../testing/index.ts';
import { pagesInMemory } from '../testing/playbook-pages.ts';

const toAcme = toOrg('acme');

function keepingGoals() {
  const pages = pagesInMemory();
  const goals = goalsInMemory(pages);
  const operations = playbookOperationsOf(pages, goals);
  const named = (name: string) => {
    const found = operations.find(({ registration }) => registration.name === name);
    if (found === undefined) {
      throw new Error(`no ${name}`);
    }
    return found;
  };
  return { pages, goals, operations, named };
}

function keysOf(schema: { readonly [keyword: string]: unknown } | undefined): readonly string[] {
  const properties = schema?.['properties'];
  return typeof properties === 'object' && properties !== null ? Object.keys(properties) : [];
}

function inputOf(registration: RouteRegistration<'org'>): readonly string[] {
  return keysOf(registration.input.schema);
}

function outputOf(registration: RouteRegistration<'org'>, identifier: string): readonly string[] {
  return keysOf(registration.output.definitions[identifier]);
}

const alpha = {
  id: 'alpha',
  name: 'Alpha',
  description: '',
  status: 'active',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
};

function descriptionOf(name: string): string {
  return keepingGoals().named(name).registration.description;
}

function sentencesOf(text: string): readonly string[] {
  return text.split(/(?<=[.!?])\s+(?=\S)/u);
}

function goalsArgumentOf(name: string): unknown {
  const properties = keepingGoals().named(name).registration.input.schema['properties'];
  return typeof properties === 'object' && properties !== null && 'goals' in properties ? properties.goals : undefined;
}

function wordsOf(name: string, gaps: readonly object[], input: unknown, output: object = alpha) {
  const { plainLanguage } = keepingGoals().named(name).registration;
  return [plainLanguage?.attempt(input), plainLanguage?.outcome({ ...output, goals: { gaps } }, input)];
}

const gap = { kind: 'measure_unreported', goal: 'g', detail: 'd', fixed_by: 'agent' } as const;

describe('the descriptions of the playbook operations with a goals port', () => {
  it('lead create_playbook with the goals it needs, where they come from and the refusal without them', () => {
    expect(sentencesOf(descriptionOf('create_playbook'))).toEqual([
      'First ask the person what this playbook should achieve for them, how they will know it worked (a number, a target, their words for a pass and a fail), and what to tell them, when and where.',
      'Propose the goals once and send them as `goals` only after their yes, as the goals guide says; without goals it is refused with the question to ask.',
      'Use it when the person wants something done that should keep working after this conversation, and none of their playbooks covers it.',
      'An id that is taken or retired is refused.',
      "`playbook` is the id every tool inside it takes, and `description` what it is for, in the person's words.",
      'It starts empty: give the person the `studio` link it answers; when the saved goals are those they agreed, record their yes with agree_playbook_goals before you build anything.',
    ]);
  });

  it('lead update_playbook with the goals, and say a playbook with none gets them here before a workflow is saved', () => {
    expect(sentencesOf(descriptionOf('update_playbook'))).toEqual([
      'Changes the goals, the name, the description or the page of an active playbook and returns it with what its goals still lack.',
      'Send `goals` to a playbook with none before saving a workflow in it, and change them with the person until they say yes, as the goals guide says.',
      "Once the person's yes to the goals is recorded, change them only after their yes to the change, and never change what they are told or how success is judged to suit what you built.",
      'Use it too when the person renames a playbook, changes what it is for or gives it a dashboard.',
      'An argument you leave out keeps its saved value.',
      '`goals` is always the whole list: a goal missing from it is removed, and one that has been judged must stay, with `retired: true`.',
      '`rename_goal`, given alone, gives one goal a new id.',
    ]);
  });

  it('lead get_playbook with its goals and what they lack', () => {
    expect(sentencesOf(descriptionOf('get_playbook'))).toEqual([
      'Reads one playbook by its id, active or retired, with its goals, what they still lack and the source of its page.',
      "Use it to read the playbook's goals or page, or a playbook whose id is known; list_playbooks finds the others.",
      '`goals.gaps` says what to ask the person or put right, and a playbook with no goals needs them before a workflow is saved in it.',
      '`playbook` is its id.',
    ]);
  });

  it('stay under 800 characters each', () => {
    expect(
      ['create_playbook', 'update_playbook', 'get_playbook'].map((name) => descriptionOf(name).length < 800),
    ).toEqual([true, true, true]);
  });

  it('say in the goals argument what it takes, in under 300 characters', () => {
    const described =
      "The whole list of the playbook's goals as YAML text, as the goals guide says, in the person's words: what it should achieve, how success is judged, and when and where to tell them";

    expect([goalsArgumentOf('create_playbook'), goalsArgumentOf('update_playbook')]).toEqual([
      expect.objectContaining({ description: described }),
      expect.objectContaining({ description: described }),
    ]);
    expect(described.length).toBeLessThan(300);
  });
});

describe('the playbook operations with a goals port', () => {
  it('make the same six org operations at the same routes', () => {
    const { operations } = keepingGoals();
    const catalog = makeCatalog(operations);

    expect(catalog.operations.map(({ name, route }) => `${name} ${route.method} ${route.path}`)).toEqual([
      'create_playbook POST /playbooks',
      'list_playbooks GET /playbooks',
      'get_playbook GET /playbooks/{playbook}',
      'update_playbook PUT /playbooks/{playbook}',
      'retire_playbook POST /playbooks/{playbook}/retire',
      'restore_playbook POST /playbooks/{playbook}/restore',
    ]);
  });

  it('give create_playbook and update_playbook an optional goals argument of at most 16,384 bytes', () => {
    const { named } = keepingGoals();
    const create = named('create_playbook').registration;
    const update = named('update_playbook').registration;

    expect(inputOf(create)).toEqual(['playbook', 'name', 'description', 'goals']);
    expect(inputOf(update)).toEqual(['playbook', 'name', 'description', 'page', 'goals', 'rename_goal']);
    expect(create.input.schema['required']).toEqual(['playbook', 'name']);
    expect(update.input.schema['required']).toEqual(['playbook']);
    expect(JSON.stringify(create.input)).toContain(`"maxLength":${String(mostGoalsBytes)}`);
  });

  it('answer the goals on create, get and update, beside what they answered before', () => {
    const { named } = keepingGoals();

    expect(outputOf(named('create_playbook').registration, 'CreatedPlaybookWithGoals')).toContain('goals');
    expect(outputOf(named('get_playbook').registration, 'PlaybookWithGoals')).toContain('goals');
    expect(outputOf(named('update_playbook').registration, 'UpdatedPlaybookWithGoals')).toContain('goals');
    expect(outputOf(named('list_playbooks').registration, 'Playbook')).not.toContain('goals');
    expect(outputOf(named('get_playbook').registration, 'PlaybookGoals')).toEqual(['source', 'versions', 'gaps']);
    expect(named('create_playbook').registration.reasons).toEqual(['conflict', 'invalid_input', 'unavailable']);
  });
});

describe('the answers of the playbook operations with a goals port', () => {
  it('answer a playbook made before goals were kept with the gap that asks the person for them', async () => {
    const { named } = keepingGoals();
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));

    expect(await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }))).toEqual({
      status: 'succeeded',
      output: { ...alpha, goals: { gaps: [noGoalGap] } },
    });
  });

  it('answer the goals saved and the page in one read', async () => {
    const { named } = keepingGoals();
    const { call } = harness();
    await createdWithGoals({ call }, named('create_playbook'));

    expect(await call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', page: '---\n---\n' }))).toEqual({
      status: 'succeeded',
      output: {
        ...alpha,
        page: { source: '---\n---\n' },
        goals: { source: goalsText, versions: versionsOfBothAt(1), gaps: [] },
      },
    });
    expect(await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }))).toMatchObject({
      output: { page: { source: '---\n---\n' }, goals: { versions: versionsOfBothAt(1) } },
    });
  });
});

describe('the size of the goals argument', () => {
  it('refuse goals of more than 16,384 bytes before anything is written', async () => {
    const { named } = keepingGoals();
    const { call, ledger } = harness();

    expect(
      await call(
        named('create_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha', goals: 'g'.repeat(mostGoalsBytes + 1) }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(
      await call(
        named('create_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha', goals: 'é'.repeat(mostGoalsBytes / 2 + 1) }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(ledger.streamNames()).toEqual([]);
  });

  it('take goals of exactly 16,384 bytes', async () => {
    const { named } = keepingGoals();
    const { call } = harness();

    expect(
      await call(
        named('create_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha', goals: 'é'.repeat(mostGoalsBytes / 2) }),
      ),
    ).toMatchObject({ status: 'succeeded' });
  });
});

describe('the plain language of the playbook operations with a goals port', () => {
  it('tell the agent, after a create, to show the person the goals and build nothing before the yes', () => {
    expect(wordsOf('create_playbook', [], { playbook: 'alpha', name: 'Alpha' })).toEqual([
      'create the playbook “alpha”',
      'Created the playbook “Alpha”. Stop here: give the person the `studio` link. If these are the goals the person said yes to, record that yes with agree_playbook_goals; if not, ask again. Build nothing before that call.',
    ]);
    expect(
      wordsOf('create_playbook', [gap, gap], { playbook: 'alpha', name: 'Alpha' }, { ...alpha, description: 'Sells.' }),
    ).toEqual([
      'create the playbook “alpha”',
      'Created the playbook “Alpha”. What it is for: Sells. Stop here: give the person the `studio` link. If these are the goals the person said yes to, record that yes with agree_playbook_goals; if not, ask again. Build nothing before that call. Its goals still have 2 gaps, each saying what is missing and who puts it right.',
    ]);
  });

  it('say after a read or an update how many gaps the goals still have, and nothing when they have none', () => {
    expect(wordsOf('get_playbook', [], { playbook: 'alpha' })).toEqual([
      'look up the playbook “alpha”',
      'Found the playbook “Alpha”.',
    ]);
    expect(wordsOf('get_playbook', [gap], { playbook: 'alpha' })[1]).toBe(
      'Found the playbook “Alpha”. Its goals still have 1 gap, each saying what is missing and who puts it right.',
    );
    expect(wordsOf('update_playbook', [], { playbook: 'alpha' })).toEqual([
      'update the playbook “alpha”',
      'Updated the playbook “Alpha”. It has no description now.',
    ]);
    expect(wordsOf('update_playbook', [gap, gap, gap], { playbook: 'alpha' })[1]).toBe(
      'Updated the playbook “Alpha”. It has no description now. Its goals still have 3 gaps, each saying what is missing and who puts it right.',
    );
  });

  it("ask, on a playbook with no goals, the person's question and say where the answer goes", () => {
    const awaited =
      ' It has no goals yet. Ask the person: What should this playbook achieve for you, and how will you know it worked? Ask too what to tell them, and where. Once they say yes, send it as the goals argument of update_playbook, as the goals guide says.';

    expect(wordsOf('get_playbook', [noGoalGap], { playbook: 'alpha' })[1]).toBe(
      `Found the playbook “Alpha”.${awaited}`,
    );
    expect(wordsOf('update_playbook', [noGoalGap], { playbook: 'alpha' })[1]).toBe(
      `Updated the playbook “Alpha”. It has no description now.${awaited}`,
    );
  });
});

describe('the description of list_playbooks with a goals port', () => {
  it('lead list_playbooks with what to ask the person before anything is made', () => {
    expect(sentencesOf(descriptionOf('list_playbooks'))).toEqual([
      'Before you make anything for the person, ask what it should achieve for them, how they will know it worked, and what they want to be told and where, as the goals guide says.',
      'Use it when the person speaks of their playbooks, or wants something done that one of them may cover.',
      'Lists the playbooks of the org that the caller may access, sorted by id.',
      'Each holds every field of the playbook, such as its name, what it is for and whether it is active.',
    ]);
  });
});

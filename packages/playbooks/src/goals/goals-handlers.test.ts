import { StudioLinks, type StudioPage } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { goalsWantedWordsOf, playbookOperationsOf, retirePlaybook } from '../index.ts';
import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { cutOnce, goalsInMemory, goalsRefusedAtSave, refusedGoals } from '../testing/goals-in-memory.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';
import { createdWithGoals, goalsText, leadGoalId, restatedGoalsText } from '../testing/index.ts';
import { pagesInMemory, refusedPage } from '../testing/playbook-pages.ts';
import { defineCreatePlaybookKeepingGoals } from './playbook-goals-operations.ts';

const untilTheYes: unknown = expect.stringMatching(/^Stop here: show the person /u);

const leadLink = `studio:goal/alpha/${leadGoalId}`;

type PlaybookGoals = ReturnType<typeof goalsInMemory>;

const toAcme = toOrg('acme');

const alpha = {
  id: 'alpha',
  name: 'Alpha',
  description: '',
  status: 'active',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
};

const savedGoals = { source: goalsText, version: 1, gaps: [] };

function keepingGoals(goalsOver: (goals: PlaybookGoals) => PlaybookGoals = (goals) => goals) {
  const pages = pagesInMemory();
  const goals = goalsOver(goalsInMemory(pages));
  const operations = playbookOperationsOf(pages, goals);
  const named = (name: string) => {
    const found = operations.find(({ registration }) => registration.name === name);
    if (found === undefined) {
      throw new Error(`no ${name}`);
    }
    return found;
  };
  return { pages, goals, named, ...harness() };
}

function linkedTo(page?: StudioPage): string {
  return page === undefined ? 'studio:' : `studio:${Object.values(page).join('/')}`;
}

describe('create_playbook where goals are kept', () => {
  it('is refused without goals, with the question for the person, and writes nothing', async () => {
    const { named, call, ledger } = keepingGoals();

    expect(await call(named('create_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: goalsWantedWordsOf(true),
      issues: [{ pointer: '/goals', detail: goalsWantedWordsOf(true) }],
    });
    expect(ledger.streamNames()).toEqual([]);
  });

  it('is refused when the check refuses the goals, and writes nothing', async () => {
    const { named, call, ledger } = keepingGoals();

    expect(
      await call(
        named('create_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha', goals: refusedGoals }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/goals' }] });
    expect(ledger.streamNames()).toEqual([]);
  });

  it('creates the playbook with its goals, which get_playbook then reads', async () => {
    const { named, call } = keepingGoals();

    expect(await createdWithGoals({ call }, named('create_playbook'))).toEqual({
      status: 'succeeded',
      output: { ...alpha, goals: savedGoals, before_building: untilTheYes },
    });
    expect(await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }))).toEqual({
      status: 'succeeded',
      output: { ...alpha, goals: savedGoals },
    });
  });
});

describe('the Studio link of create_playbook where goals are kept', () => {
  it('links to its lead goal in Studio, or to the playbook when the goals name none', async () => {
    const { goals: kept, run, dispatch } = keepingGoals();
    const creating = defineCreatePlaybookKeepingGoals(kept);
    const created = (playbook: string, goals: string) =>
      run(
        dispatch(creating, toAcme(acmeAdmin, { playbook, name: 'Alpha', goals })).pipe(
          Effect.provideService(StudioLinks, linkedTo),
        ),
      );

    expect(await created('alpha', goalsText)).toMatchObject({ output: { studio: leadLink } });
    expect(await created('beta', 'goals')).toMatchObject({ output: { studio: 'studio:playbook/beta' } });
  });
});

describe('a create whose goals were cut after the playbook was registered', () => {
  it('leaves a playbook without goals, which the same caller repairs by creating it again', async () => {
    const { named, call } = keepingGoals(cutOnce);
    const create = named('create_playbook');

    expect(await createdWithGoals({ call }, create)).toMatchObject({ status: 'failed' });
    expect(await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }))).toMatchObject({
      output: { goals: { gaps: [{ kind: 'no_goal' }] } },
    });
    expect(await createdWithGoals({ call }, create, { caller: adaOfAcme })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
      detail: 'There is already a playbook alpha in this org',
    });
    expect(await createdWithGoals({ call }, create)).toEqual({
      status: 'succeeded',
      output: { ...alpha, goals: savedGoals, before_building: untilTheYes },
    });
  });

  it('is refused as taken once the goals are saved, so a second retry writes nothing', async () => {
    const { named, call } = keepingGoals();
    const create = named('create_playbook');
    await createdWithGoals({ call }, create);

    expect(await createdWithGoals({ call }, create, { goals: restatedGoalsText })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
    });
    expect(await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }))).toMatchObject({
      output: { goals: savedGoals },
    });
  });

  it('is refused as taken when the playbook was retired since', async () => {
    const { named, call } = keepingGoals(cutOnce);
    const create = named('create_playbook');
    await createdWithGoals({ call }, create);
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }));

    expect(await createdWithGoals({ call }, create)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'taken',
      detail: 'The playbook alpha is retired, and its id stays reserved for it: restore_playbook brings it back',
    });
  });
});

async function made() {
  const kept = keepingGoals();
  await createdWithGoals(kept, kept.named('create_playbook'));
  return kept;
}

describe('update_playbook where goals are kept', () => {
  it('asks for goals among what may be given when nothing is', async () => {
    const { named, call } = await made();
    const words = 'Give name, description, page or goals, at least one, to update the playbook';

    expect(await call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: words,
      issues: [{ pointer: '', detail: words }],
    });
  });

  it('saves the page and the goals together, then the name', async () => {
    const { named, call } = await made();

    expect(
      await call(
        named('update_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', name: 'Beta', page: '---\n---\n', goals: restatedGoalsText }),
      ),
    ).toEqual({
      status: 'succeeded',
      output: {
        ...alpha,
        name: 'Beta',
        page: { source: '---\n---\n' },
        goals: { source: restatedGoalsText, version: 2, gaps: [] },
        before_building: untilTheYes,
      },
    });
  });

  it('adds goals to a playbook that has none', async () => {
    const { named, call } = keepingGoals(cutOnce);
    await createdWithGoals({ call }, named('create_playbook'));

    expect(
      await call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', goals: restatedGoalsText })),
    ).toMatchObject({ status: 'succeeded', output: { goals: { source: restatedGoalsText, version: 1 } } });
  });

  it('renames without saving the page or the goals, and answers them as they stand', async () => {
    const { named, call } = await made();

    expect(
      await call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', description: 'Answers sales' })),
    ).toEqual({ status: 'succeeded', output: { ...alpha, description: 'Answers sales', goals: savedGoals } });
  });
});

describe('a refused update_playbook where goals are kept', () => {
  it('changes nothing when the check refuses the goals', async () => {
    const { named, call } = await made();

    expect(
      await call(
        named('update_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', name: 'Beta', page: '---\n---\n', goals: refusedGoals }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/goals' }] });
    expect(await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }))).toEqual({
      status: 'succeeded',
      output: { ...alpha, goals: savedGoals },
    });
  });

  it('changes nothing when the save refuses the goals against those saved before', async () => {
    const { named, call } = await made();

    expect(
      await call(
        named('update_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', name: 'Beta', page: '---\n---\n', goals: goalsRefusedAtSave }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '' }] });
    expect(await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }))).toEqual({
      status: 'succeeded',
      output: { ...alpha, goals: savedGoals },
    });
  });

  it('changes nothing when the page is refused beside goals', async () => {
    const { named, call } = await made();

    expect(
      await call(
        named('update_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', name: 'Beta', page: refusedPage, goals: restatedGoalsText }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/page' }] });
    expect(await call(named('get_playbook'), toAcme(acmeAdmin, { playbook: 'alpha' }))).toEqual({
      status: 'succeeded',
      output: { ...alpha, goals: savedGoals },
    });
  });
});

describe('update_playbook of a playbook that cannot change', () => {
  it('is refused for a retired playbook, and for one that does not exist', async () => {
    const { named, call } = await made();
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }));

    expect(
      await call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', goals: restatedGoalsText })),
    ).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'retired' });
    expect(
      await call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'gamma', goals: restatedGoalsText })),
    ).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });
});

const untoldPages = pagesInMemory();

const untoldOperations = playbookOperationsOf(untoldPages, goalsInMemory(untoldPages, false));

function untoldNamed(name: string) {
  const found = untoldOperations.find(({ registration }) => registration.name === name);
  if (found === undefined) {
    throw new Error(`no ${name}`);
  }
  return found;
}

describe('the playbook operations where goals are kept and messages are off', () => {
  const toldWords = /\btold\b|to tell them|when and where/u;

  it('ask nothing about being told, in their descriptions, the goals argument or the refusal for missing goals', async () => {
    const { call } = harness();
    const described = ['create_playbook', 'list_playbooks', 'update_playbook'].map((name) =>
      JSON.stringify([untoldNamed(name).registration.description, untoldNamed(name).registration.input]),
    );
    const refused = await call(untoldNamed('create_playbook'), toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));

    expect(described.map((text) => toldWords.test(text))).toEqual([false, false, false]);
    expect(refused).toMatchObject({ status: 'rejected', reason: 'invalid_input', detail: goalsWantedWordsOf(false) });
  });
});

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookOperationsOf, retirePlaybook } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { cutOnce, goalsInMemory } from '../testing/goals-in-memory.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';
import { createdWithGoals, goalsText, leadGoalId, plainGoalId } from '../testing/index.ts';
import { pagesInMemory } from '../testing/playbook-pages.ts';
import type { DefinitionSavedAgain } from './playbook-goals.ts';

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

function keepingGoals(goalsOver: (goals: PlaybookGoals) => PlaybookGoals = (goals) => goals) {
  const pages = pagesInMemory();
  const operations = playbookOperationsOf(pages, goalsOver(goalsInMemory(pages)));
  const named = (name: string) => {
    const found = operations.find(({ registration }) => registration.name === name);
    if (found === undefined) {
      throw new Error(`no ${name}`);
    }
    return found;
  };
  return { named, ...harness() };
}

async function made() {
  const kept = keepingGoals();
  await createdWithGoals(kept, kept.named('create_playbook'));
  return kept;
}

const leadServers: readonly DefinitionSavedAgain[] = [{ type: 'workflow', name: 'lead-intake' }];

function servingTheLeadGoal(goals: PlaybookGoals): PlaybookGoals {
  return {
    ...goals,
    rename: (address, renaming) =>
      Effect.map(goals.rename(address, renaming), (held) => ({
        ...held,
        savedAgain: renaming.from === leadGoalId ? leadServers : [],
      })),
  };
}

const renamedGoals = {
  source: goalsText.replace(`- id: ${leadGoalId}`, '- id: first-customers'),
  versions: [
    { id: 'first-customers', version: 1 },
    { id: plainGoalId, version: 1 },
  ],
  gaps: [],
};

describe('update_playbook renaming a goal', () => {
  it('gives a goal a new id when given alone, and answers the playbook with its goals and the workflows saved again', async () => {
    const kept = keepingGoals(servingTheLeadGoal);
    const { named, call } = kept;
    await createdWithGoals(kept, named('create_playbook'));
    const renaming = (id: string, newId: string) =>
      call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', rename_goal: { id, new_id: newId } }));

    expect(await renaming(leadGoalId, 'first-customers')).toEqual({
      status: 'succeeded',
      output: { ...alpha, goals: renamedGoals, updated_definitions: leadServers },
    });
    expect(await renaming(plainGoalId, 'weekly-orders')).toMatchObject({
      status: 'succeeded',
      output: { goals: { versions: [{ id: 'first-customers' }, { id: 'weekly-orders' }] } },
    });
    expect(await renaming('weekly-orders', 'Weekly Orders')).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/rename_goal/new_id' }],
    });
  });
});

describe('update_playbook refusing to rename a goal', () => {
  it('is refused with another change in the call, for a goal the playbook does not have, and in a retired playbook', async () => {
    const { named, call } = await made();
    const renaming = { rename_goal: { id: leadGoalId, new_id: 'first-customers' } };

    expect(
      await call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', name: 'Beta', ...renaming })),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/rename_goal' }] });
    expect(
      await call(
        named('update_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', rename_goal: { id: 'no-such-goal', new_id: 'first-customers' } }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/rename_goal/id' }] });
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }));
    expect(await call(named('update_playbook'), toAcme(acmeAdmin, { playbook: 'alpha', ...renaming }))).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'retired',
    });
  });

  it('is refused for a playbook that has no goals yet', async () => {
    const { named, call } = keepingGoals(cutOnce);
    await createdWithGoals({ call }, named('create_playbook'));

    expect(
      await call(
        named('update_playbook'),
        toAcme(acmeAdmin, { playbook: 'alpha', rename_goal: { id: leadGoalId, new_id: 'first-customers' } }),
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/rename_goal/id' }] });
  });
});

describe('the words of a goal renamed', () => {
  it('tell a rename apart from an update, and as none, one or several workflows saved again', () => {
    const plainLanguage = keepingGoals().named('update_playbook').registration.plainLanguage;
    const asked = { playbook: 'alpha', rename_goal: { id: leadGoalId, new_id: 'first-customers' } };
    const answered = { ...alpha, goals: renamedGoals };
    const savedAgain: readonly (readonly DefinitionSavedAgain[])[] = [
      [],
      leadServers,
      [...leadServers, { type: 'workflow', name: 'lead-scoring' }],
    ];
    const outcomes = savedAgain.map((saved: readonly DefinitionSavedAgain[]) =>
      plainLanguage?.outcome({ ...answered, updated_definitions: saved }, asked),
    );

    expect(new Set(outcomes).size).toBe(3);
    expect(plainLanguage?.outcome(answered, asked)).toBe(outcomes[0]);
    expect(plainLanguage?.attempt(asked)).not.toBe(plainLanguage?.attempt({ playbook: 'alpha' }));
  });
});

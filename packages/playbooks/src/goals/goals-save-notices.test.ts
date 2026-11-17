import type { Notice } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { playbookOperationsOf } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { goalsInMemory } from '../testing/goals-in-memory.ts';
import { harness, toOrg } from '../testing/harness.ts';
import { createdWithGoals, restatedGoalsText } from '../testing/index.ts';
import { pagesInMemory } from '../testing/playbook-pages.ts';

const toAcme = toOrg('acme');

const noticed: Notice = {
  kind: 'per_is_an_auto_word',
  detail: 'The goal Checks is judged per run, a word Auto uses for its own parts.',
  at: '/0/per',
  certainty: 'likely',
};

const beforeGoingOn =
  'One thing to double-check is in notices: if you are sure of what you did, carry on and tell the person in one sentence why you kept it; if not, now is a good time to fix it.';

async function answersWith(notices: readonly Notice[]) {
  const pages = pagesInMemory();
  const operations = playbookOperationsOf(pages, goalsInMemory(pages, true, notices));
  const named = (name: string) => {
    const found = operations.find(({ registration }) => registration.name === name);
    if (found === undefined) {
      throw new Error(`no ${name}`);
    }
    return found;
  };
  const { call } = harness();
  const update = named('update_playbook');
  const created = await createdWithGoals({ call }, named('create_playbook'));
  const changed = await call(update, toAcme(acmeAdmin, { playbook: 'alpha', goals: restatedGoalsText }));
  const renamed = await call(update, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Beta' }));
  return { created, changed, renamed, operations };
}

describe('the answers of a goals save', () => {
  it('carry the notices of the goals saved, with what to do before going on, on a create and a change, and none on a rename', async () => {
    const { created, changed, renamed } = await answersWith([noticed]);

    expect([created, changed]).toMatchObject([
      { status: 'succeeded', output: { notices: [noticed], before_going_on: beforeGoingOn } },
      { status: 'succeeded', output: { notices: [noticed], before_going_on: beforeGoingOn } },
    ]);
    expect(renamed).toMatchObject({ status: 'succeeded' });
    expect(JSON.stringify(renamed)).not.toContain('notices');
  });

  it('leave notices out when there is nothing to double-check, and describe them in both output schemas', async () => {
    const { created, changed, operations } = await answersWith([]);

    expect([JSON.stringify(created), JSON.stringify(changed)].map((text) => text.includes('notices'))).toEqual([
      false,
      false,
    ]);
    expect(
      operations
        .filter(({ registration }) => JSON.stringify(registration.output).includes('"before_going_on"'))
        .map(({ registration }) => registration.name)
        .toSorted(),
    ).toEqual(['create_playbook', 'update_playbook']);
  });
});

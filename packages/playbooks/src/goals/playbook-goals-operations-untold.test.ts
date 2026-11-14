import { describe, expect, it } from 'vitest';

import { playbookOperationsOf } from '../index.ts';
import { goalsInMemory } from '../testing/goals-in-memory.ts';
import { firstMoment } from '../testing/harness.ts';
import { goalsText } from '../testing/index.ts';
import { pagesInMemory } from '../testing/playbook-pages.ts';

const alpha = {
  id: 'alpha',
  name: 'Alpha',
  description: '',
  status: 'active',
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
};

interface Answered {
  readonly gaps?: readonly object[];
  readonly output?: object;
  readonly messages?: boolean;
}

function wordsOf(name: string, input: unknown, { gaps = [], output = alpha, messages = false }: Answered = {}) {
  const pages = pagesInMemory();
  const operation = playbookOperationsOf(pages, goalsInMemory(pages, messages)).find(
    ({ registration }) => registration.name === name,
  );
  return operation?.registration.plainLanguage?.outcome({ ...output, goals: { gaps } }, input);
}

const gap = { kind: 'measure_unreported', goal: 'g', detail: 'd', fixed_by: 'agent' } as const;

describe('the plain language of the playbook operations where Auto sends no goal messages', () => {
  const unsent =
    'Auto sends no goal messages here: if the person asked to be told, tell them so first, and build a post only after their yes.';

  it('tell the agent, after a create, that no goal messages are sent, before the gaps', () => {
    expect(wordsOf('create_playbook', { playbook: 'alpha', name: 'Alpha' }, { gaps: [gap] })).toBe(
      `Created the playbook “Alpha”. Stop here: show the person its goals through the studio link and change them with update_playbook until they say yes to them as saved; build no function or workflow before that yes. ${unsent} Its goals still have 1 gap, each saying what is missing and who puts it right.`,
    );
  });

  it('put it before what the playbook is for, which the agent sent itself', () => {
    const sold = { ...alpha, description: 'Sells.' };

    expect(wordsOf('create_playbook', { playbook: 'alpha', name: 'Alpha' }, { output: sold })).toBe(
      `Created the playbook “Alpha”. Stop here: show the person its goals through the studio link and change them with update_playbook until they say yes to them as saved; build no function or workflow before that yes. ${unsent} What it is for: Sells.`,
    );
    expect(wordsOf('update_playbook', { playbook: 'alpha', goals: goalsText }, { output: sold })).toBe(
      `Updated the playbook “Alpha”. ${unsent} What it is for: Sells.`,
    );
  });

  it('tell the agent so after an update that saves goals, and not after one that leaves them', () => {
    expect(wordsOf('update_playbook', { playbook: 'alpha', goals: goalsText })).toBe(
      `Updated the playbook “Alpha”. ${unsent} It has no description now.`,
    );
    expect(wordsOf('update_playbook', { playbook: 'alpha' })).toBe(
      'Updated the playbook “Alpha”. It has no description now.',
    );
  });

  it('say nothing of it where goal messages are sent', () => {
    expect(wordsOf('update_playbook', { playbook: 'alpha', goals: goalsText }, { messages: true })).toBe(
      'Updated the playbook “Alpha”. It has no description now.',
    );
    expect(wordsOf('create_playbook', { playbook: 'alpha', name: 'Alpha' }, { messages: true })).not.toContain(unsent);
  });
});

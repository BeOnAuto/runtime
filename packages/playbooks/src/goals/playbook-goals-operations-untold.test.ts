import { describe, expect, it } from 'vitest';

import { goalsSavedWordsOf, playbookOperationsOf } from '../index.ts';
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

const unsent = goalsSavedWordsOf(false);

function toldAndUntold(name: string, input: unknown, answered: Answered = {}) {
  return {
    told: String(wordsOf(name, input, { ...answered, messages: true })),
    untold: String(wordsOf(name, input, { ...answered, messages: false })),
  };
}

function followingTheNote({ told, untold }: { readonly told: string; readonly untold: string }): string | undefined {
  const at = untold.indexOf(unsent);
  return at === -1 || untold.replace(unsent, '') !== told ? undefined : told.slice(at);
}

describe('the plain language of the playbook operations where Auto sends no goal messages', () => {
  it('tell the agent, after a create, that no goal messages are sent, before the gaps', () => {
    expect(
      followingTheNote(toldAndUntold('create_playbook', { playbook: 'alpha', name: 'Alpha' }, { gaps: [gap] })),
    ).toMatch(/1 gap/u);
  });

  it('put it before what the playbook is for, which the agent sent itself', () => {
    const sold = { ...alpha, description: 'Sells.' };
    const answers = [
      toldAndUntold('create_playbook', { playbook: 'alpha', name: 'Alpha' }, { output: sold }).untold,
      toldAndUntold('update_playbook', { playbook: 'alpha', goals: goalsText }, { output: sold }).untold,
    ];

    expect(answers.map((words) => words.slice(0, words.indexOf('Sells.')))).toEqual([
      expect.stringContaining(unsent),
      expect.stringContaining(unsent),
    ]);
  });

  it('tell the agent so after an update that saves goals, and not after one that leaves them', () => {
    const leaving = toldAndUntold('update_playbook', { playbook: 'alpha' });

    expect(followingTheNote(toldAndUntold('update_playbook', { playbook: 'alpha', goals: goalsText }))).toBeDefined();
    expect(leaving.untold).toBe(leaving.told);
    expect(leaving.untold).not.toContain(unsent);
  });

  it('is no words at all where goal messages are sent', () => {
    expect(goalsSavedWordsOf(true)).toBe('');
  });
});

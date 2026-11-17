import { defineCommand } from '@on.auto/operations';
import { Schema } from 'effect';

import { createPlaybookFields, createPlaybookSentences, createPlaybookWords } from '../operations/create-playbook.ts';
import { updatePlaybookFields, updatePlaybookWords } from '../operations/update-playbook.ts';
import { createdWithGoalsWordsOf, updatedWithGoalsWordsOf } from '../plain-language/goals-words.ts';
import { playbookCreatedWithGoals } from './goals-created.ts';
import {
  CreatedPlaybookWithGoalsSchema,
  playbookGoalsFieldOf,
  UpdatedPlaybookWithGoalsSchema,
} from './goals-fields.ts';
import { playbookUpdatedWithGoals } from './goals-updated.ts';
import type { CheckedGoals, PlaybookGoals } from './playbook-goals.ts';

const [, whenToUse, , ...whatItTakes] = createPlaybookSentences;

const firstAsked = {
  told: 'First ask the person what this playbook should achieve for them, how they will know it worked (a number, a target, their words for a pass and a fail), and what to tell them, when and where.',
  untold:
    'First ask the person what this playbook should achieve for them and how they will know it worked (a number, a target, their words for a pass and a fail).',
};

const createSentences = [
  'Propose the goals once and send them as `goals` only after their yes, as the goals guide says; without goals it is refused with the question to ask.',
  whenToUse,
  ...whatItTakes,
  'It starts empty: give the person the `studio` link it answers; when the saved goals are those they agreed, record their yes with agree_playbook_goals before you build anything.',
];

const changedOnlyAfterTheYes = {
  told: "Once the person's yes to the goals is recorded, change them only after their yes to the change, and never change what they are told or how success is judged to suit what you built.",
  untold:
    "Once the person's yes to the goals is recorded, change them only after their yes to the change, and never change how success is judged to suit what you built.",
};

function wordsWhere(words: { readonly told: string; readonly untold: string }, messages: boolean): string {
  return messages ? words.told : words.untold;
}

export function defineCreatePlaybookKeepingGoals<Checked extends CheckedGoals>(goals: PlaybookGoals<Checked>) {
  const { messages } = goals;
  return defineCommand('org', {
    name: 'create_playbook',
    title: 'Create playbook',
    description: [wordsWhere(firstAsked, messages), ...createSentences].join(' '),
    route: { method: 'POST', path: '/playbooks' },
    successStatus: 201,
    inputSchema: Schema.Struct({ ...createPlaybookFields, goals: Schema.optionalKey(playbookGoalsFieldOf(messages)) }),
    outputSchema: CreatedPlaybookWithGoalsSchema,
    reasons: ['conflict', 'invalid_input', 'unavailable'],
    handle: (input) => playbookCreatedWithGoals(goals, input),
    plainLanguage: { ...createPlaybookWords, outcome: createdWithGoalsWordsOf(messages) },
  });
}

export function defineUpdatePlaybookKeepingGoals<Checked extends CheckedGoals>(goals: PlaybookGoals<Checked>) {
  const { messages } = goals;
  return defineCommand('org', {
    name: 'update_playbook',
    title: 'Update playbook',
    description: [
      'Changes the goals, the name, the description or the page of an active playbook and returns it with what its goals still lack.',
      'Send `goals` to a playbook with none before saving a workflow in it, and change them with the person until they say yes, as the goals guide says.',
      wordsWhere(changedOnlyAfterTheYes, messages),
      'Use it too when the person renames a playbook, changes what it is for or gives it a dashboard.',
      'An argument you leave out keeps its saved value.',
      '`goals` is always the whole list: a goal missing from it is removed, and one that has been judged must stay, with `retired: true`.',
    ].join(' '),
    repeatable: true,
    route: { method: 'PUT', path: '/playbooks/{playbook}' },
    inputSchema: Schema.Struct({ ...updatePlaybookFields, goals: Schema.optionalKey(playbookGoalsFieldOf(messages)) }),
    outputSchema: UpdatedPlaybookWithGoalsSchema,
    reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
    handle: (input) => playbookUpdatedWithGoals(goals, input),
    plainLanguage: { ...updatePlaybookWords, outcome: updatedWithGoalsWordsOf(messages) },
  });
}

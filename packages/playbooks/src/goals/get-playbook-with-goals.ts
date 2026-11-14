import { defineQuery } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';

import { PlaybookIdField } from '../operations/playbook-fields.ts';
import { foundPlaybook } from '../operations/registry-loading.ts';
import { goalsStandingOf } from '../plain-language/goals-words.ts';
import { playbookNamed, purposeOf } from '../plain-language/playbook-words.ts';
import { PlaybookWithGoalsSchema } from './goals-fields.ts';
import { withItsGoals } from './held-goals.ts';
import type { CheckedGoals, PlaybookGoals } from './playbook-goals.ts';

export function defineGetPlaybookWithGoals<Checked extends CheckedGoals>(goals: PlaybookGoals<Checked>) {
  return defineQuery('org', {
    name: 'get_playbook',
    title: 'Get playbook',
    description: [
      'Reads one playbook by its id, active or retired, with its goals, what they still lack and the source of its page.',
      "Use it to read the playbook's goals or page, or a playbook whose id is known; list_playbooks finds the others.",
      '`goals.gaps` says what to ask the person or put right, and a playbook with no goals needs them before a workflow is saved in it.',
      '`playbook` is its id.',
    ].join(' '),
    route: { method: 'GET', path: '/playbooks/{playbook}' },
    inputSchema: Schema.Struct({ playbook: PlaybookIdField }),
    outputSchema: PlaybookWithGoalsSchema,
    reasons: ['not_found'],
    handle: ({ playbook }) => Effect.flatMap(foundPlaybook(playbook), (found) => withItsGoals(goals, found)),
    plainLanguage: {
      task: 'look up a playbook',
      attempt: ({ playbook }) => `look up the playbook ${quoted(playbook)}`,
      outcome: (playbook) =>
        `Found ${playbookNamed(playbook)}.${purposeOf(playbook)}${goalsStandingOf(playbook.goals.gaps, goals.messages)}`,
    },
  });
}

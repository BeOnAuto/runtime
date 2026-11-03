import { defineQuery } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';

import { playbookNamed, purposeOf } from '../plain-language/playbook-words.ts';
import { PlaybookSchema } from '../registry/playbook.ts';
import { PlaybookIdField } from './playbook-fields.ts';
import { withItsPage, type PlaybookPages } from './playbook-pages.ts';
import { foundPlaybook } from './registry-loading.ts';

export function defineGetPlaybook(pages: PlaybookPages) {
  return defineQuery('org', {
    name: 'get_playbook',
    title: 'Get playbook',
    description: [
      'Reads one playbook by its id, active or retired, with the source of its page.',
      "Use it to read the playbook's page, or a playbook whose id is known; list_playbooks finds the others.",
      '`playbook` is its id.',
    ].join(' '),
    route: { method: 'GET', path: '/playbooks/{playbook}' },
    inputSchema: Schema.Struct({ playbook: PlaybookIdField }),
    outputSchema: PlaybookSchema,
    reasons: ['not_found'],
    handle: ({ playbook }) => Effect.flatMap(foundPlaybook(playbook), (found) => withItsPage(pages, found)),
    plainLanguage: {
      task: 'look up a playbook',
      attempt: ({ playbook }) => `look up the playbook ${quoted(playbook)}`,
      outcome: (playbook) => `Found ${playbookNamed(playbook)}.${purposeOf(playbook)}`,
    },
  });
}

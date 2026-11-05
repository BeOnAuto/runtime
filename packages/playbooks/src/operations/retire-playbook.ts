import { defineCommand } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { playbookNamed } from '../plain-language/playbook-words.ts';
import { PlaybookSchema } from '../registry/playbook.ts';
import { PlaybookIdField } from './playbook-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const retirePlaybook = defineCommand('org', {
  name: 'retire_playbook',
  title: 'Retire playbook',
  description: [
    'Retires a playbook and returns it: it stays readable with its history, takes no changes or runs, and keeps its id, so no other playbook takes it.',
    'restore_playbook brings it back. Use retire_playbook when the person asks to retire that playbook; update_playbook changes its name or description.',
    'Retiring a retired playbook changes nothing.',
  ].join(' '),
  repeatable: true,
  route: { method: 'POST', path: '/playbooks/{playbook}/retire' },
  inputSchema: Schema.Struct({ playbook: PlaybookIdField }),
  outputSchema: PlaybookSchema,
  reasons: ['not_found', 'conflict'],
  handle: ({ playbook }) => recordInRegistry({ type: 'retire', playbook }),
  plainLanguage: {
    task: 'retire a playbook',
    attempt: ({ playbook }) => `retire the playbook ${quoted(playbook)}`,
    outcome: (playbook) =>
      `Retired ${playbookNamed(playbook)}. It does not change until it is restored, and no other playbook takes its id.`,
  },
});

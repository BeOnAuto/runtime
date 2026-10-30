import { defineCommand, quoted } from '@on.auto/operations';
import { Schema } from 'effect';

import { playbookNamed } from '../plain-language/playbook-words.ts';
import { PlaybookSchema } from '../registry/playbook.ts';
import { PlaybookIdField } from './playbook-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const retirePlaybook = defineCommand('org', {
  name: 'retire_playbook',
  title: 'Retire playbook',
  description: [
    'Retires a playbook for good and returns it, readable with its history but never to change, be restored or have its id used again.',
    'Use it only when the person asks to retire that playbook; update_playbook changes its name or description instead.',
    'Retiring a retired playbook changes nothing.',
  ].join(' '),
  irreversible: true,
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
      `Retired ${playbookNamed(playbook)}. It can no longer change, and there is no way to restore it.`,
  },
});

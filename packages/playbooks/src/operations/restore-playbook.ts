import { defineCommand } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { playbookNamed } from '../plain-language/playbook-words.ts';
import { PlaybookSchema } from '../registry/playbook.ts';
import { PlaybookIdField } from './playbook-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const restorePlaybook = defineCommand('org', {
  name: 'restore_playbook',
  title: 'Restore playbook',
  description: [
    'Restores a retired playbook and returns it, active again under its own id, with its functions, workflows, page and history as they were when it was retired.',
    'Use it when the person asks to bring back a retired playbook; list_playbooks with include_retired lists the retired ones.',
    'Restoring a playbook that is not retired changes nothing.',
  ].join(' '),
  repeatable: true,
  route: { method: 'POST', path: '/playbooks/{playbook}/restore' },
  inputSchema: Schema.Struct({ playbook: PlaybookIdField }),
  outputSchema: PlaybookSchema,
  reasons: ['not_found', 'conflict'],
  handle: ({ playbook }) => recordInRegistry({ type: 'restore', playbook }),
  plainLanguage: {
    task: 'restore a playbook',
    attempt: ({ playbook }) => `restore the playbook ${quoted(playbook)}`,
    outcome: (playbook) => `Restored ${playbookNamed(playbook)}. It is active again and can change and run as before.`,
  },
});

import { defineCommand, quoted } from '@on.auto/operations';
import { Schema } from 'effect';

import { playbookNamed, purposeOf } from '../plain-language/playbook-words.ts';
import { PlaybookSchema } from '../registry/playbook.ts';
import { PlaybookDescriptionField, PlaybookIdField, PlaybookNameField } from './playbook-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const updatePlaybook = defineCommand('org', {
  name: 'update_playbook',
  title: 'Update playbook',
  description: [
    'Replaces the name and the description of an active playbook and returns it.',
    'Use it when the person renames a playbook or changes what it is for.',
    'Both are given in full, even when one stays the same.',
  ].join(' '),
  repeatable: true,
  route: { method: 'PUT', path: '/playbooks/{playbook}' },
  inputSchema: Schema.Struct({
    playbook: PlaybookIdField,
    name: PlaybookNameField,
    description: PlaybookDescriptionField,
  }),
  outputSchema: PlaybookSchema,
  reasons: ['not_found', 'conflict'],
  handle: ({ playbook, name, description }) => recordInRegistry({ type: 'update', playbook, name, description }),
  plainLanguage: {
    task: 'update a playbook',
    attempt: ({ playbook }) => `update the playbook ${quoted(playbook)}`,
    outcome: (playbook) => `Updated ${playbookNamed(playbook)}.${purposeOf(playbook, ' It has no description now.')}`,
  },
});

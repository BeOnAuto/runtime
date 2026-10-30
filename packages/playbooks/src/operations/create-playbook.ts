import { Caller, defineCommand, quoted, recordedCallerOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { playbookNamed, purposeOf } from '../plain-language/playbook-words.ts';
import { PlaybookSchema } from '../registry/playbook.ts';
import { PlaybookDescriptionField, PlaybookIdField, PlaybookNameField } from './playbook-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const createPlaybook = defineCommand('org', {
  name: 'create_playbook',
  title: 'Create playbook',
  description: [
    'Start here when the person wants something done in their business that should keep working after this conversation, however they put it, and none of their playbooks covers it.',
    'Creates a playbook for one business responsibility, such as reviewing campaign briefs, and returns it, active and empty.',
    'An id that is taken or retired is refused.',
    "`playbook` is the id every tool inside it takes, and `description` what it is for, in the person's words.",
  ].join(' '),
  route: { method: 'POST', path: '/playbooks' },
  successStatus: 201,
  inputSchema: Schema.Struct({
    playbook: PlaybookIdField,
    name: PlaybookNameField,
    description: Schema.optionalKey(PlaybookDescriptionField),
  }),
  outputSchema: PlaybookSchema,
  reasons: ['conflict'],
  handle: ({ playbook, name, description = '' }) =>
    Caller.use((caller) =>
      recordInRegistry({ type: 'create', playbook, name, description, created_by: recordedCallerOf(caller) }),
    ).pipe(Effect.catchTag('not_found', Effect.die)),
  plainLanguage: {
    task: 'create a playbook',
    attempt: ({ playbook }) => `create the playbook ${quoted(playbook)}`,
    outcome: (playbook) =>
      `Created ${playbookNamed(playbook)}.${purposeOf(playbook)} Its functions and workflows come next.`,
  },
});

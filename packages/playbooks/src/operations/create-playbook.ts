import { Caller, defineCommand, recordedCallerOf, withStudioLink } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';

import { playbookNamed, purposeOf } from '../plain-language/playbook-words.ts';
import { CreatedPlaybookSchema } from '../registry/playbook.ts';
import { PlaybookDescriptionField, PlaybookIdField, PlaybookNameField } from './playbook-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const createPlaybook = defineCommand('org', {
  name: 'create_playbook',
  title: 'Create playbook',
  description: [
    'Creates a playbook for one business responsibility, such as reviewing campaign briefs, and returns it empty.',
    'Use it when the person wants something done that should keep working after this conversation, and none of their playbooks covers it.',
    'The work it does is a workflow, its functions the steps.',
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
  outputSchema: CreatedPlaybookSchema,
  reasons: ['conflict'],
  handle: ({ playbook, name, description = '' }) =>
    Caller.use((caller) =>
      recordInRegistry({ type: 'create', playbook, name, description, created_by: recordedCallerOf(caller) }),
    ).pipe(
      Effect.catchTag('not_found', Effect.die),
      Effect.flatMap((created) => withStudioLink(created, { kind: 'playbook', playbook })),
    ),
  plainLanguage: {
    task: 'create a playbook',
    attempt: ({ playbook }) => `create the playbook ${quoted(playbook)}`,
    outcome: (playbook) =>
      `Created ${playbookNamed(playbook)}.${purposeOf(playbook)} Its functions and workflows come next.`,
  },
});

import { Caller, defineCommand, recordedCallerOf, withStudioLink } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';

import { playbookNamed, purposeOf } from '../plain-language/playbook-words.ts';
import { CreatedPlaybookSchema, type Playbook } from '../registry/playbook.ts';
import { PlaybookDescriptionField, PlaybookIdField, PlaybookNameField } from './playbook-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const createPlaybookSentences = [
  'Creates a playbook for one business responsibility, and returns it empty.',
  'Use it when the person wants something done that should keep working after this conversation, and none of their playbooks covers it.',
  'Each job it does again and again is a workflow, and each part of a job a function of the type that part needs.',
  'An id that is taken or retired is refused.',
  "`playbook` is the id every tool inside it takes, and `description` what it is for, in the person's words.",
];

export const createPlaybookFields = {
  playbook: PlaybookIdField,
  name: PlaybookNameField,
  description: Schema.optionalKey(PlaybookDescriptionField),
};

export interface Creating {
  readonly playbook: string;
  readonly name: string;
  readonly description?: string;
}

export function playbookRegistered({ playbook, name, description = '' }: Creating) {
  return Caller.use((caller) =>
    recordInRegistry({ type: 'create', playbook, name, description, created_by: recordedCallerOf(caller) }),
  ).pipe(Effect.catchTag('not_found', Effect.die));
}

function playbookCreated(creating: Creating) {
  return Effect.flatMap(playbookRegistered(creating), (created) =>
    withStudioLink(created, { kind: 'playbook', playbook: creating.playbook }),
  );
}

export const createPlaybookWords = {
  task: 'create a playbook',
  attempt: ({ playbook }: { readonly playbook: string }) => `create the playbook ${quoted(playbook)}`,
  outcome: (playbook: Pick<Playbook, 'name' | 'description'>) =>
    `Created ${playbookNamed(playbook)}.${purposeOf(playbook)} Its functions and workflows come next.`,
};

export const createPlaybook = defineCommand('org', {
  name: 'create_playbook',
  title: 'Create playbook',
  description: createPlaybookSentences.join(' '),
  route: { method: 'POST', path: '/playbooks' },
  successStatus: 201,
  inputSchema: Schema.Struct(createPlaybookFields),
  outputSchema: CreatedPlaybookSchema,
  reasons: ['conflict'],
  handle: playbookCreated,
  plainLanguage: createPlaybookWords,
});

import { PlaybookIdSchema, RecordedCallerSchema, studioLinkField } from '@on.auto/operations';
import { Schema } from 'effect';

export const PlaybookSchema = Schema.Struct({
  id: PlaybookIdSchema.annotate({ description: 'The id of the playbook, unique within its org' }),
  name: Schema.String.annotate({ description: 'The display name of the playbook' }),
  description: Schema.String.annotate({ description: 'What the playbook is for, or empty' }),
  status: Schema.Literals(['active', 'retired']).annotate({
    description: 'active, or retired until restore_playbook restores it',
  }),
  created_at: Schema.String.annotate({ description: 'When the playbook was created, in ISO 8601 UTC' }),
  created_by: RecordedCallerSchema.annotate({ description: 'The caller who created the playbook, by id and name' }),
  updated_at: Schema.String.annotate({ description: 'When the playbook last changed, in ISO 8601 UTC' }),
  retired_at: Schema.optionalKey(
    Schema.String.annotate({ description: 'When the playbook was retired, in ISO 8601 UTC' }),
  ),
  page: Schema.optionalKey(
    Schema.Struct({
      source: Schema.String.annotate({ description: 'The page as it was saved, YAML of its data and runs' }),
    }).annotate({
      description: "The playbook's page, its dashboard, where it has one; from get_playbook and update_playbook",
    }),
  ),
}).annotate({ identifier: 'Playbook', description: 'A playbook of the org' });

export type Playbook = typeof PlaybookSchema.Type;

export const CreatedPlaybookSchema = Schema.Struct({
  ...PlaybookSchema.fields,
  studio: studioLinkField('made'),
}).annotate({ identifier: 'CreatedPlaybook', description: 'A playbook just created, with its page in Studio' });

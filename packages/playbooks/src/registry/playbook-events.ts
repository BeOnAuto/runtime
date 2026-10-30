import { ActedContextSchema, PlaybookIdSchema, RecordedCallerSchema, factOf, type Decided } from '@on.auto/operations';
import { Schema } from 'effect';

const ofThePlaybook = { playbook: PlaybookIdSchema };

export const PlaybookEventSchema = Schema.Union([
  factOf(
    'playbook_created',
    Schema.Struct({
      ...ofThePlaybook,
      name: Schema.String,
      description: Schema.String,
      created_by: RecordedCallerSchema,
    }),
    ActedContextSchema,
  ),
  factOf(
    'playbook_updated',
    Schema.Struct({
      ...ofThePlaybook,
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    }),
    ActedContextSchema,
  ),
  factOf('playbook_retired', Schema.Struct(ofThePlaybook), ActedContextSchema),
]);

export type RecordedPlaybookEvent = typeof PlaybookEventSchema.Type;

export type PlaybookEvent = Decided<RecordedPlaybookEvent>;

export type PlaybookCreated = Extract<RecordedPlaybookEvent, { readonly type: 'playbook_created' }>;

export type PlaybookUpdated = Extract<RecordedPlaybookEvent, { readonly type: 'playbook_updated' }>;

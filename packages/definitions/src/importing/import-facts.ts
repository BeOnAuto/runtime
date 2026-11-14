import { ActedContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';

const ImportMarkSchema = Schema.Struct({ import_id: Schema.String, digest: Schema.String });

export const ImportEventSchema = Schema.Union([
  factOf('playbook_import_started', ImportMarkSchema, ActedContextSchema),
  factOf('playbook_imported', ImportMarkSchema, ActedContextSchema),
]);

export type RecordedImportEvent = typeof ImportEventSchema.Type;

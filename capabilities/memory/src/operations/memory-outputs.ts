import { PagingOutputFields } from '@on.auto/operations';
import { Schema } from 'effect';

import { MemoryScopeSchema } from '../facts/memory-facts.ts';

const IdField = Schema.String.annotate({ description: 'The id of the memory, the same for every version of it' });

const ScopeField = MemoryScopeSchema.annotate({
  description: 'Who keeps the memory: the playbook, or its organization',
});

const AboutSchema = Schema.Struct({ from: Schema.String, to: Schema.String }).annotate({
  description: 'The days the memory is about, each as YYYY-MM-DD',
});

const writtenFields = {
  written_at: Schema.String.annotate({ description: 'When this version of the memory was written, in ISO 8601 UTC' }),
  written_by: Schema.String.annotate({ description: 'The id of the caller who wrote it' }),
};

export const RememberedSchema = Schema.Struct({
  id: IdField,
  version: Schema.Int.annotate({ description: 'The version of the memory now kept, 1 for a new memory' }),
  scope: ScopeField,
}).annotate({ identifier: 'Remembered', description: 'A memory as it is kept now' });

const RecalledMemorySchema = Schema.Struct({
  id: IdField,
  scope: ScopeField,
  text: Schema.String.annotate({ description: 'What was remembered' }),
  tags: Schema.Array(Schema.String).annotate({ description: 'The tags of the memory' }),
  about: Schema.optionalKey(AboutSchema),
  ...writtenFields,
}).annotate({ identifier: 'RecalledMemory', description: 'A memory a recall found' });

export const RecalledSchema = Schema.Struct({
  memories: Schema.Array(RecalledMemorySchema).annotate({
    description: 'The memories recalled, newest first, within the characters asked',
  }),
});

export const ForgottenSchema = Schema.Struct({
  id: IdField,
  scope: ScopeField,
  status: Schema.Literals(['forgotten', 'erased']).annotate({
    description: 'forgotten, so no recall finds it, or erased, its text gone from the ledger too',
  }),
}).annotate({ identifier: 'Forgotten', description: 'A memory no recall finds any more' });

const ListedMemorySchema = Schema.Struct({
  id: IdField,
  scope: ScopeField,
  playbook: Schema.optionalKey(
    Schema.String.annotate({ description: 'The playbook that keeps the memory, for a memory a playbook keeps' }),
  ),
  status: Schema.Literals(['kept', 'forgotten', 'erased', 'moved']).annotate({
    description: 'kept, forgotten, erased, its text gone, or moved to the other scope, under the id a move answered',
  }),
  version: Schema.Int.annotate({ description: 'The latest version of the memory' }),
  text: Schema.NullOr(Schema.String).annotate({ description: 'What was remembered, or null once it is erased' }),
  tags: Schema.Array(Schema.String).annotate({ description: 'The tags of the memory' }),
  about: Schema.optionalKey(AboutSchema),
  expires_at: Schema.NullOr(Schema.String).annotate({
    description: 'When the memory stops being recalled, in ISO 8601 UTC, or null for one kept until forgotten',
  }),
  ...writtenFields,
}).annotate({ identifier: 'ListedMemory', description: 'A memory, whatever became of it' });

export const MemoryListingSchema = Schema.Struct({ memories: Schema.Array(ListedMemorySchema), ...PagingOutputFields });

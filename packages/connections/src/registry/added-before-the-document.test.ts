import { readFileSync } from 'node:fs';

import { ActedContextSchema, factOf, RecordedCallerSchema } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEntrySchema, ConnectionTypeSchema } from './connection-entry.ts';
import { CredentialSchema } from './credential.ts';

const AddedBeforeTheDocument = factOf(
  'connection_added',
  Schema.Struct({
    connection: Schema.String,
    name: Schema.String,
    server_type: ConnectionTypeSchema,
    provider: Schema.NullOr(Schema.String),
    placeholders: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
    entry: ConnectionEntrySchema,
    credential: CredentialSchema,
    says: Schema.Record(Schema.String, Schema.String),
    added_by: RecordedCallerSchema,
  }),
  ActedContextSchema,
);

const recorded: unknown = JSON.parse(readFileSync(new URL('0.59.0/connection_added.json', import.meta.url), 'utf8'));

describe('a connection added with its document whole, as a release before the member reads it', () => {
  it('reads the fact recorded in 0.59.0 through that release’s schema, passing over the document it does not know', () => {
    const read = Schema.decodeUnknownSync(Schema.toCodecJson(AddedBeforeTheDocument))(recorded);

    expect(read).toEqual({
      type: 'connection_added',
      data: {
        connection: 'connection-1',
        name: 'ledgers',
        server_type: 'openapi',
        provider: null,
        placeholders: null,
        entry: { base_url: 'https://api.ledgers.example.com/v1' },
        credential: {
          kind: 'secret',
          name: 'X-Ledgers-Key',
          in: 'header',
          instructions: 'Make a key under [Settings, API keys](https://ledgers.example.com/settings/keys).',
          key_page: 'https://ledgers.example.com/settings/keys',
        },
        says: {},
        added_by: { id: 'key_7f3a', name: 'key_7f3a' },
      },
      context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
    });
  });
});

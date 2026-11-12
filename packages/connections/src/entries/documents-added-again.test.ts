import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEntrySchema } from '../registry/connection-entry.ts';
import { added, adding } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';
import {
  givenAs,
  ledgersBase,
  ledgersDocument,
  listingEntries,
  textOf,
  withPaths,
} from '../testing/ledgers-documents.ts';
import { AddedEntrySchema } from './document-fields.ts';

const ListedSchema = Schema.Struct({
  output: Schema.Struct({
    connections: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        type: Schema.String,
        entry: Schema.Record(Schema.String, Schema.Unknown),
        credential: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ),
  }),
});

const listedOf = Schema.decodeUnknownSync(ListedSchema);

async function listedIn(h: Harness) {
  const [listed] = listedOf(await h.call(operationNamed(h.operations, 'list_connections'), ada)).output.connections;
  return listed;
}

describe('an HTTP API given its document whole, added again from what list_connections answers for it', () => {
  it('keeps every member of its entry and its credential, with its document corrected', async () => {
    const h = harness();
    const { id } = await added(
      h,
      givenAs(ledgersDocument, {
        entry: {
          base_url: ledgersBase,
          document_text: textOf(ledgersDocument),
          headers: { 'X-Region': 'north' },
          query_params: { view: 'full' },
          allowed: ['list_entries'],
          playbooks: ['sales'],
          record_content: false,
          request_id: 'X-Request-Id',
        },
      }),
    );
    const before = await listedIn(h);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    const again = await adding(h, {
      name: before?.name,
      type: before?.type,
      entry: { ...before?.entry, document_text: textOf(withPaths({ '/entries': listingEntries })) },
      credential: before?.credential,
    });

    expect(again).toMatchObject({ status: 'succeeded', output: { document: { tool_count: 1 } } });
    expect(await listedIn(h)).toEqual(before);
  });

  it('can be, since the entry add_connection takes holds what list_connections answers and the document itself alone', () => {
    expect(Object.keys(AddedEntrySchema.fields)).toEqual([
      ...Object.keys(ConnectionEntrySchema.fields),
      'document_text',
    ]);
  });
});

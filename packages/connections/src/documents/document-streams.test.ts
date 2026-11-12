import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ConnectionDocumentEventSchema,
  documentDecider,
  documentStreamOfOrg,
  isConnectionDocumentStreamOfOrg,
  keptTextOf,
} from './document-streams.ts';

const text = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Ledgers', version: '1' },
  paths: { '/entries': { get: { operationId: 'list_entries', summary: 'Lists the entries of the ledger.' } } },
});

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

describe('the facts of the documents connections were added with', () => {
  recordedFactsBehaviour({
    schema: ConnectionDocumentEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.59.0': [{ type: 'connection_document_kept', data: keptTextOf(text), context: acted }],
    },
  });
});

describe('a document kept in the stream its fingerprint names', () => {
  it('is kept once, a keeping of the same text again appending nothing and answering the text kept first', async () => {
    const { service } = memoryLedger();
    const stream = documentStreamOfOrg('acme', keptTextOf(text).sha256);
    const keeping = { text, ...acted };

    const first = await Effect.runPromise(service.execute(stream, documentDecider, keeping));
    const again = await Effect.runPromise(service.execute(stream, documentDecider, { ...keeping, by: 'person:ada' }));

    expect([first.version, again.version, again.state]).toEqual([1, 1, keptTextOf(text)]);
  });

  it('is named under its org by the SHA-256 of its text in hexadecimal, which no other name of a stream passes for', () => {
    const { sha256 } = keptTextOf(text);
    const named = [
      documentStreamOfOrg('acme', sha256),
      documentStreamOfOrg('globex', sha256),
      `org/acme/connection-documents/${sha256.toUpperCase()}`,
      `org/acme/connection-documents/${sha256}/more`,
      `org/acme/connection-documents/${sha256.slice(1)}`,
      'org/acme/connections',
    ].map((stream) => isConnectionDocumentStreamOfOrg('acme', stream));

    expect([documentStreamOfOrg('acme', sha256), named]).toEqual([
      'org/acme/connection-documents/12fe0445fa0547202e360e1fa76122bd707bb9c3a0ba1dbd5017574f46955e6b',
      [true, false, false, false, false, false],
    ]);
  });
});

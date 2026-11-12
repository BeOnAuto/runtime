import { describe, expect, it } from 'vitest';

import { issuesIn } from '../testing/additions.ts';
import { harness } from '../testing/harness.ts';
import {
  givenAs,
  ledgers,
  ledgersBase,
  ledgersDocument,
  listingEntries,
  recordedAfter,
  refusedAt,
  textOf,
  withPaths,
} from '../testing/ledgers-documents.ts';

function nestedLists(depth: number): unknown {
  return Array.from({ length: depth }).reduce<unknown>((inner) => [inner], []);
}

const refusedByItsFields = [
  [
    'without base_url',
    { ...ledgers, entry: { document_text: textOf(ledgersDocument) } },
    refusedAt(
      '/entry/base_url',
      'Expected base_url, which an HTTP API given its document in document_text takes: every call goes there, since no address written inside the document is taken',
    ),
  ],
  [
    'beside the address of a document',
    { ...ledgers, entry: { ...ledgers.entry, document: 'https://ledgers.example.com/openapi.json' } },
    refusedAt(
      '/entry/document_text',
      'Expected document or document_text, not both: document is the address of the OpenAPI document, document_text the document itself',
    ),
  ],
  [
    'for an MCP server',
    { ...ledgers, type: 'mcp', entry: { url: 'https://mcp.ledgers.example.com/mcp', document_text: '{}' } },
    refusedAt('/entry/document_text', 'Not a field of an mcp server'),
  ],
  [
    'beside a provider',
    { provider: 'files', entry: { document_text: '{}' } },
    refusedAt('/entry/document_text', 'Expected no document_text: the provider gives the server'),
  ],
  [
    'of more than 16,384 bytes',
    givenAs(withPaths({ '/entries': { get: { ...listingEntries.get, description: 'é'.repeat(8_200) } } })),
    refusedAt(
      '/entry/document_text',
      'The document takes 16,741 bytes, more than the 16,384 a document given in document_text may take; describe only the calls the job needs',
    ),
  ],
  [
    'of text that is not well-formed Unicode',
    givenAs(`{"openapi":"3.1.0","info":{"title":"\uD800"}}`),
    refusedAt('/entry/document_text', 'Expected text of well-formed Unicode, which UTF-8 carries'),
  ],
  [
    'nor an address, for an HTTP API',
    { ...ledgers, entry: { base_url: ledgersBase } },
    refusedAt(
      '/entry',
      'Expected document, the https URL of the OpenAPI document of the HTTP API, or document_text, the document itself, one of the two',
    ),
  ],
] as const;

describe('a document given in document_text that its fields refuse', () => {
  it.each(refusedByItsFields)('is refused %s, at its place, recording nothing', async (_, input, issues) => {
    const { outcome, facts } = await recordedAfter(harness(), input);

    expect([issuesIn(outcome), facts]).toEqual([issues, 0]);
  });
});

const ofTheDocument = '/entry/document_text';

const refusedByItsReader = [
  [
    'that is neither JSON nor YAML',
    '{"openapi": "3.1.0",\n  paths: [',
    refusedAt(ofTheDocument, expect.stringMatching(/^The document is neither JSON nor YAML: line 2, column \d+: /u)),
  ],
  [
    'of Swagger 2.0',
    textOf({ swagger: '2.0', info: { title: 'Ledgers', version: '1' }, paths: {} }),
    refusedAt(
      ofTheDocument,
      'At /swagger of the document: A Swagger 2.0 document, which the runtime does not read; give it the document converted to OpenAPI 3',
    ),
  ],
  [
    'whose path is a whole address',
    textOf(withPaths({ 'https://elsewhere.example.com/entries': listingEntries })),
    refusedAt(
      ofTheDocument,
      'At /paths/https:~1~1elsewhere.example.com~1entries of the document: Expected a path that begins with /, since a path written otherwise joins the host or the port of base_url and a call would go elsewhere',
    ),
  ],
  [
    'whose path climbs out of base_url',
    textOf(withPaths({ '/entries/../admin': listingEntries })),
    refusedAt(
      ofTheDocument,
      'At /paths/~1entries~1..~1admin of the document: A path a call cannot keep as written: a . or .. segment, or a ? or #, would move the call out of it',
    ),
  ],
  [
    'whose path climbs out of base_url through a tab and a line break',
    textOf(withPaths({ '/entries/.\t.\n/admin': listingEntries })),
    refusedAt(
      ofTheDocument,
      'At /paths/~1entries~1.\t.\n~1admin of the document: A path a call cannot keep as written: a . or .. segment, or a ? or #, would move the call out of it',
    ),
  ],
  [
    'whose path holds a query',
    textOf(withPaths({ '/entries?all=true': listingEntries })),
    refusedAt(
      ofTheDocument,
      'At /paths/~1entries?all=true of the document: A path a call cannot keep as written: a . or .. segment, or a ? or #, would move the call out of it',
    ),
  ],
  [
    'whose path holds a fragment',
    textOf(withPaths({ '/entries#all': listingEntries })),
    refusedAt(
      ofTheDocument,
      'At /paths/~1entries#all of the document: A path a call cannot keep as written: a . or .. segment, or a ? or #, would move the call out of it',
    ),
  ],
  [
    'with two operations of one name',
    textOf(withPaths({ '/entries': listingEntries, '/journal': listingEntries })),
    refusedAt(
      ofTheDocument,
      'At /paths/~1journal/get of the document: The tool name list_entries is the name of the operation at /paths/~1entries/get too; give one of them another operationId',
    ),
  ],
  [
    'nested more than 128 levels deep',
    textOf({ ...ledgersDocument, 'x-nested': nestedLists(130) }),
    refusedAt(ofTheDocument, 'The document nests values more than 128 levels deep'),
  ],
  [
    'that refers outside itself',
    textOf(
      withPaths({
        '/entries': {
          get: {
            ...listingEntries.get,
            parameters: [{ name: 'from', in: 'query', schema: { $ref: 'https://elsewhere.example.com/day.json' } }],
          },
        },
      }),
    ),
    refusedAt(
      ofTheDocument,
      expect.stringMatching(/^At \/paths\/~1entries\/get\/parameters\/0\/schema\/\$ref of the document: /u),
    ),
  ],
  [
    'that holds a credential written into it',
    textOf(
      withPaths({
        '/entries': {
          get: {
            ...listingEntries.get,
            parameters: [{ name: 'X-Ledgers-Key', in: 'header', example: 'sk-live-0123456789abcdefghij' }],
          },
        },
      }),
    ),
    refusedAt(
      ofTheDocument,
      'At /paths/~1entries/get/parameters/0/example of the document: Looks like a credential, which a document given in document_text never holds: the person gives it on the page the link opens',
    ),
  ],
  [
    'that holds a credential in the words of a summary',
    textOf(
      withPaths({
        '/entries': {
          get: {
            ...listingEntries.get,
            summary: 'Lists the entries; send sk-live-0123456789abcdefghij with each call',
          },
        },
      }),
    ),
    refusedAt(
      ofTheDocument,
      'At /paths/~1entries/get/summary of the document: Looks like a credential, which a document given in document_text never holds: the person gives it on the page the link opens',
    ),
  ],
  [
    'that holds a credential under a property named as prose',
    textOf(
      withPaths({
        '/entries': {
          get: {
            ...listingEntries.get,
            parameters: [
              {
                name: 'filter',
                in: 'query',
                schema: {
                  type: 'object',
                  properties: { title: { type: 'string', example: 'sk-live-0123456789abcdefghij' } },
                },
              },
            ],
          },
        },
      }),
    ),
    refusedAt(
      ofTheDocument,
      'At /paths/~1entries/get/parameters/0/schema/properties/title/example of the document: Looks like a credential, which a document given in document_text never holds: the person gives it on the page the link opens',
    ),
  ],
  [
    'that describes no operation',
    textOf(withPaths({})),
    refusedAt(ofTheDocument, 'The document offers no tool: it describes no operation'),
  ],
  [
    'whose one operation the runtime cannot offer',
    textOf(
      withPaths({
        '/accounts': {
          get: {
            operationId: 'list_accounts',
            parameters: [{ name: 'X-Account', in: 'header', required: true, schema: { type: 'string' } }],
          },
        },
      }),
    ),
    refusedAt(
      ofTheDocument,
      expect.stringMatching(/^The document offers no tool for the operation list_accounts \(GET \/accounts\): /u),
    ),
  ],
  [
    'of an operation the runtime cannot offer, beside one it offers',
    textOf(
      withPaths({
        '/entries': listingEntries,
        '/accounts': {
          get: {
            operationId: 'list_accounts',
            parameters: [{ name: 'X-Account', in: 'header', required: true, schema: { type: 'string' } }],
          },
        },
      }),
    ),
    refusedAt(
      ofTheDocument,
      expect.stringMatching(/^The document offers no tool for the operation list_accounts \(GET \/accounts\): /u),
    ),
  ],
] as const;

describe('a document given in document_text that the reader of a document refuses', () => {
  it.each(refusedByItsReader)('is refused %s, at its place, recording nothing', async (_, text, issues) => {
    const { outcome, facts } = await recordedAfter(harness(), givenAs(text));

    expect([issuesIn(outcome), facts]).toEqual([issues, 0]);
  });
});

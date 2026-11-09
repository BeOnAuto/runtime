import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProviderList } from '@on.auto/providers';
import { providerOf } from '@on.auto/providers/testing';
import { Schema } from 'effect';

import { providersDocument, providersDocumentOf } from './docs-providers.ts';

const ToolSchema = Schema.Struct({ name: Schema.String, mark: Schema.Literals(['reads', 'acts']) });

type PublishedTool = typeof ToolSchema.Type;

const decodeTools = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      providers: Schema.Array(
        Schema.Struct({ name: Schema.String, tools: Schema.optionalKey(Schema.Array(ToolSchema)) }),
      ),
    }),
  ),
);

function toolsIn(document: string, name: string): readonly PublishedTool[] {
  const found = decodeTools(document).providers.find((provider) => provider.name === name);
  if (found?.tools === undefined) {
    throw new Error(`${name} publishes no tools`);
  }
  return found.tools;
}

const notesDocument = JSON.stringify({
  openapi: '3.1.0',
  servers: [{ url: 'https://api.notes.example.com/v1' }],
  paths: {
    '/notes': {
      parameters: [],
      get: { operationId: 'listNotes', summary: 'List notes' },
      post: { operationId: 'addNote' },
    },
    '/notes/search': { post: { operationId: 'searchNotes' } },
    '/notes/{id}': {
      head: { operationId: 'noteExists' },
      get: { operationId: 'readNote' },
      delete: { operationId: 'removeNote' },
      options: { operationId: 'noteOptions' },
    },
  },
});

function notesTools(marks?: unknown): readonly PublishedTool[] {
  const notes = providerOf(
    {
      name: 'notes',
      title: 'Notes',
      description: 'Read and change the notes of an account.',
      website: 'https://developer.notes.example.com',
      type: 'openapi',
      document: 'documents/notes.openapi.json',
      ...(marks === undefined ? {} : { marks }),
      credentials: [
        {
          kind: 'secret',
          in: 'header',
          name: 'X-Api-Key',
          instructions: 'Make a key at [Notes](https://app.notes.example.com/keys) under **Keys**.',
          key_page: 'https://app.notes.example.com/keys',
        },
      ],
    },
    'https://api.notes.example.com/v1',
  );
  const list: ProviderList = {
    providers: [notes],
    documents: new Map([['documents/notes.openapi.json', { text: notesDocument, bytes: notesDocument.length }]]),
  };
  return toolsIn(providersDocumentOf(list), 'notes');
}

await test('each operation of a document beside the entries is a tool, named by its operationId in the order the runtime lists them', () => {
  assert.deepEqual(notesTools(), [
    { name: 'listNotes', mark: 'reads' },
    { name: 'addNote', mark: 'acts' },
    { name: 'searchNotes', mark: 'acts' },
    { name: 'readNote', mark: 'reads' },
    { name: 'removeNote', mark: 'acts' },
    { name: 'noteOptions', mark: 'acts' },
    { name: 'noteExists', mark: 'reads' },
  ]);
});

await test('every shipped tool is published by the name the runtime gives it, a name of the characters a tool name keeps', () => {
  const names = decodeTools(providersDocument).providers.flatMap(({ tools = [] }) => tools.map(({ name }) => name));
  assert.ok(names.length > 0);
  assert.deepEqual(
    names.filter((name) => !/^[\w.-]{1,128}$/u.test(name)),
    [],
  );
});

await test("a tool is marked by the entry's marks before the method of its operation", () => {
  assert.deepEqual(
    notesTools({ reads: ['searchNotes'], acts: ['readNote'] }).filter(({ name }) =>
      ['searchNotes', 'readNote'].includes(name),
    ),
    [
      { name: 'searchNotes', mark: 'reads' },
      { name: 'readNote', mark: 'acts' },
    ],
  );
  assert.deepEqual(
    toolsIn(providersDocument, 'google-analytics').filter(({ name }) => name.includes('audienceExports')),
    [
      { name: 'analyticsdata.properties.audienceExports.list', mark: 'reads' },
      { name: 'analyticsdata.properties.audienceExports.create', mark: 'acts' },
      { name: 'analyticsdata.properties.audienceExports.get', mark: 'reads' },
      { name: 'analyticsdata.properties.audienceExports.query', mark: 'reads' },
    ],
  );
});

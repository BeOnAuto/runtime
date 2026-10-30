import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCommand, defineQuery, makeCatalog } from '../index.ts';
import { addNote, getNote } from '../testing/notes.ts';
import { getPlaybookLabel, labelPlaybook } from '../testing/playbook-labels.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

const probe = { title: 'Probe', description: 'Probes the catalog.', outputSchema: Empty, reasons: [] };

const getNoteById = defineQuery('playbook', {
  ...probe,
  name: 'get_note_by_id',
  route: { method: 'GET', path: '/notes/{id}' },
  inputSchema: Schema.Struct({ id: Schema.String }),
  handle: () => Effect.succeed({}),
});

const getLatestNote = defineQuery('playbook', {
  ...probe,
  name: 'get_latest_note',
  route: { method: 'GET', path: '/notes/latest' },
  inputSchema: Empty,
  handle: () => Effect.succeed({}),
});

const replaceNote = defineCommand('playbook', {
  ...probe,
  name: 'replace_note',
  route: { method: 'PUT', path: '/notes/{name}' },
  inputSchema: Schema.Struct({ name: Schema.String }),
  handle: () => Effect.succeed({}),
});

const getNoteOfOrg = defineQuery('org', {
  ...probe,
  name: 'get_note',
  route: { method: 'GET', path: '/notes/{name}' },
  inputSchema: Schema.Struct({ playbook: Schema.optionalKey(Schema.String), name: Schema.String }),
  handle: () => Effect.succeed({}),
});

const addNoteToOrg = defineCommand('org', {
  ...probe,
  name: 'add_note',
  route: { method: 'POST', path: '/notes' },
  inputSchema: Schema.Struct({ name: Schema.String }),
  handle: () => Effect.succeed({}),
});

const replaceNoteInOrg = defineCommand('org', {
  ...probe,
  name: 'get_note',
  route: { method: 'POST', path: '/notes/{name}/replacing' },
  inputSchema: Schema.Struct({ playbook: Schema.optionalKey(Schema.String), name: Schema.String }),
  handle: () => Effect.succeed({}),
});

const getNoteOfPlaybook = defineQuery('org', {
  ...probe,
  name: 'get_note_of_playbook',
  route: { method: 'GET', path: '/playbooks/{playbook}/notes/{name}' },
  inputSchema: Schema.Struct({ playbook: Schema.String, name: Schema.String }),
  handle: () => Effect.succeed({}),
});

describe('a catalog', () => {
  const catalog = makeCatalog([labelPlaybook, addNote, getPlaybookLabel, getNote]);

  it('lists every operation in the order given', () => {
    expect(catalog.operations.map(({ scope, name }) => `${scope}:${name}`)).toEqual([
      'org:label_playbook',
      'playbook:add_note',
      'org:get_playbook_label',
      'playbook:get_note',
    ]);
  });

  it('lists the operations of one scope', () => {
    expect(catalog.operationsIn('org').map(({ name }) => name)).toEqual(['label_playbook', 'get_playbook_label']);
    expect(catalog.operationsIn('playbook').map(({ name }) => name)).toEqual(['add_note', 'get_note']);
  });

  it('may be empty', () => {
    expect(makeCatalog([]).operations).toEqual([]);
  });

  it('rejects a name used twice in one scope', () => {
    expect(() => makeCatalog([addNote, labelPlaybook, addNote])).toThrow(
      'The operation name add_note is used more than once',
    );
  });
});

describe('a name used at both scopes', () => {
  it('names an org operation that takes the playbook it answers for beside the playbook operation, one in each scope', () => {
    const catalog = makeCatalog([getNote, getNoteOfOrg]);

    expect(catalog.operationsIn('org').map(({ name }) => name)).toEqual(['get_note']);
    expect(catalog.operationsIn('playbook').map(({ name }) => name)).toEqual(['get_note']);
  });

  it('is refused when the org operation takes no playbook, since it could not answer for the playbook of the other', () => {
    expect(() => makeCatalog([addNote, addNoteToOrg])).toThrow(
      'The operation name add_note is used at both scopes, so the org operation must take the playbook it answers for',
    );
  });

  it('is refused when the two are not of one kind, so a command never takes the place of a query on /mcp', () => {
    expect(() => makeCatalog([getNote, replaceNoteInOrg])).toThrow(
      'The operation name get_note is used at both scopes, so both must be of one kind, and the org one is a command',
    );
  });
});

describe('the routes of a catalog', () => {
  it('may not repeat a method and path, whatever their parameters are called', () => {
    expect(() => makeCatalog([getNote, getNoteById])).toThrow(
      'The operations get_note and get_note_by_id share the route GET /orgs/{org}/playbooks/{playbook}/notes/{id}',
    );
  });

  it('may not repeat one across scopes once the scope prefixes are applied', () => {
    expect(() => makeCatalog([getNote, getNoteOfPlaybook])).toThrow(
      'The operations get_note and get_note_of_playbook share the route GET /orgs/{org}/playbooks/{playbook}/notes/{name}',
    );
  });

  it('may share a path under another method, or a literal segment where another has a parameter', () => {
    expect(makeCatalog([getNote, replaceNote, getLatestNote]).operations).toHaveLength(3);
  });
});

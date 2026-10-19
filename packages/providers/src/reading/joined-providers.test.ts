import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import { AddedProviderEntrySchema, joinedProviders, type ProviderEntry } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { fixtureProviders, ledgers, metrics, tracker } from '../testing/fixture-providers.ts';

const decodeAdded = Schema.decodeUnknownResult(AddedProviderEntrySchema, { errors: 'all', onExcessProperty: 'error' });

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function addedProblemsOf(entry: unknown): readonly (readonly [string, string])[] {
  return Result.match(decodeAdded(entry), {
    onSuccess: () => [],
    onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      formatIssues(issue).issues.map(({ message, path = [] }) => [`/${path.map(String).join('/')}`, message] as const),
  });
}

const notes: ProviderEntry = decodedEntry({
  name: 'notes',
  title: 'Notes',
  description: 'Read and write the notes of a team.',
  website: 'https://developer.notes.example.com',
  type: 'openapi',
  document: 'https://notes.example.com/openapi.json',
  credentials: [{ kind: 'none' }],
});

const ownTracker: ProviderEntry = decodedEntry({ ...tracker, url: 'https://tracker.internal.example.com/{site}/mcp' });

describe('the providers whoever runs the runtime adds', () => {
  it('join the shipped list, sorted by name, each reached at its address, the folder of the shipped documents kept', () => {
    const joined = joinedProviders(fixtureProviders, [notes]);

    expect(joined.providers.map(({ entry, address }) => [entry.name, address])).toEqual([
      ['ledgers', 'https://api.ledgers.example.com/{tenant}/v2'],
      ['metrics', 'https://mcp.metrics.example.com/mcp'],
      ['notes', 'https://notes.example.com/openapi.json'],
      ['regions', 'https://{api_host}/v1'],
      ['tracker', 'https://{site}.tracker.example.com/mcp'],
    ]);
    expect(joined.documents).toBe(fixtureProviders.documents);
  });

  it('win the name of a shipped one, which is no longer listed', () => {
    const joined = joinedProviders(fixtureProviders, [ownTracker]);

    expect(joined.providers.filter(({ entry }) => entry.name === 'tracker')).toEqual([
      { entry: ownTracker, address: 'https://tracker.internal.example.com/{site}/mcp' },
    ]);
    expect(joined.providers.map(({ entry }) => entry.name)).toEqual(['ledgers', 'metrics', 'regions', 'tracker']);
  });
});

describe('the entry of a provider whoever runs the runtime adds', () => {
  it('takes what a shipped entry takes, but a document beside the entries, which are the runtime’s own', () => {
    expect([ledgers, metrics, notes].map((entry) => addedProblemsOf(entry))).toEqual([[], [], []]);
    expect(addedProblemsOf({ ...notes, document: 'documents/notes.openapi.json' })).toEqual([
      [
        '/document',
        "Expected the https URL of the OpenAPI document, or an http URL on a loopback address: a provider whoever runs the runtime adds names its document by its address, since the documents beside the entries are the runtime's own",
      ],
    ]);
  });
});

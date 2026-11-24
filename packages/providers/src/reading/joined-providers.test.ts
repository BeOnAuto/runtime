import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import { AddedProviderEntrySchema, joinedProviders, ProviderEntrySchema, type ProviderEntry } from '../index.ts';
import { chatOverASocket } from '../testing/chat-destinations.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import {
  aPost,
  aReply,
  carrying,
  mapping,
  ofTheApp,
  overASocketCarryingReplies,
  postTypes,
  trackerOverASocket,
} from '../testing/event-destinations.ts';
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
    const byItsAddress = [
      '/document',
      "Expected the https URL of the OpenAPI document, or an http URL on a loopback address: a provider whoever runs the runtime adds names its document by its address, since the documents beside the entries are the runtime's own",
    ];

    expect([ledgers, metrics, notes].map((entry) => addedProblemsOf(entry))).toEqual([[], [], []]);
    expect(
      ['documents/notes.openapi.json', 'documents/slack.openapi.json'].map((document) =>
        addedProblemsOf({ ...notes, document }),
      ),
    ).toEqual([[byItsAddress], [byItsAddress]]);
  });
});

describe('a provider whoever runs the runtime adds that names a gateway', () => {
  it('is refused at its gateway, since only an entry the runtime ships has a document beside it to place the key by', () => {
    const throughAGateway = {
      ...notes,
      credentials: [
        {
          kind: 'authorization',
          issuer: 'https://notes.example.com',
          gateway: {
            url: 'https://gateway.notes.example.com/connections',
            audiences: {
              connections: 'https://gateway.notes.example.com',
              calls: 'https://gateway.notes.example.com/api',
            },
          },
          in: 'security',
          name: 'connection_key',
        },
      ],
    };

    expect(addedProblemsOf(throughAGateway)).toEqual([
      [
        '/credentials/0/gateway',
        'Expected no gateway: only an entry the runtime ships names one, since the document beside it says the header its key is sent in, and a provider whoever runs the runtime adds names its document by its address',
      ],
    ]);
  });
});

function sending(destination: unknown) {
  return addedProblemsOf({ ...notes, events: { destinations: [destination] } });
}

describe('a provider whoever runs the runtime adds whose service sends', () => {
  it('makes Auto read, and is refused a reply its deliveries carry, which only an entry the runtime ships declares', () => {
    const refused = [
      '/events/destinations/0/filter/reply',
      'Expected no reply: only an entry the runtime ships declares one, since a reply a delivery carries can answer a request, and a provider whoever runs the runtime adds only makes Auto read',
    ];
    const overItsSocket = { ...trackerOverASocket, events: { destinations: [overASocketCarryingReplies] } };

    expect([
      sending(ofTheApp),
      sending(carrying(ofTheApp, aReply)),
      addedProblemsOf(overItsSocket),
      Result.isSuccess(Schema.decodeUnknownResult(ProviderEntrySchema)(overItsSocket)),
    ]).toEqual([[], [refused], [refused], true]);
  });

  it('is refused a click its deliveries carry, as it is refused a reply', () => {
    const click = {
      when: { '$request.body#/type': ['block_actions'] },
      conversation: '$request.body#/channel',
      to: '$request.body#/message',
      sender: '$request.body#/user',
      action: '$request.body#/action',
      id: '$request.body#/id',
    };

    expect(sending({ ...ofTheApp, filter: { ...ofTheApp.filter, click } })).toEqual([
      [
        '/events/destinations/0/filter/click',
        'Expected no click: only an entry the runtime ships declares one, since a click a delivery carries can answer a request, and a provider whoever runs the runtime adds only makes Auto read',
      ],
    ]);
  });

  it('is refused the events its service reports, which only an entry the runtime ships declares, as a shipped entry is not', () => {
    const reporting = { ...notes, events: { types: postTypes, destinations: [mapping(ofTheApp, aPost)] } };

    expect(addedProblemsOf(reporting).map(([path]) => path)).toEqual([
      '/events/types',
      '/events/destinations/0/events',
    ]);
    expect(Result.isSuccess(Schema.decodeUnknownResult(ProviderEntrySchema)(reporting))).toBe(true);
  });

  it('is refused a chat, at the top of the entry and on its destination, which only an entry the runtime ships declares', () => {
    expect(addedProblemsOf(chatOverASocket).map(([path]) => path)).toEqual(['/chat', '/events/destinations/0/chat']);
    expect(Result.isSuccess(Schema.decodeUnknownResult(ProviderEntrySchema)(chatOverASocket))).toBe(true);
  });
});

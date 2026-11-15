import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  asNamedIn,
  conversationsOf,
  eventDestinationOf,
  joinedProviders,
  providerFoundBy,
  providerNamed,
  rendersOf,
  type NamedAs,
} from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { ofTheApp } from '../testing/event-destinations.ts';
import {
  fixtureProviders,
  ledgers,
  metrics,
  providerListOf,
  providerOf,
  tracker,
} from '../testing/fixture-providers.ts';

const reply = {
  tool: 'post_comment',
  with: { issue: '{{ sent.conversation }}', text: '{{ message }}' },
  sent: '/id',
};

const issues = providerOf({
  ...tracker,
  name: 'issues',
  aliases: ['tracker', 'tickets'],
  renders: 'cards',
  conversations: { tell: 'all', reply },
  events: { destinations: [ofTheApp] },
});

const notesBeside = providerOf(
  {
    name: 'notes',
    aliases: ['jottings'],
    title: 'Notes',
    description: 'Read and write the notes of a team.',
    website: 'https://developer.notes.example.com',
    type: 'openapi',
    document: 'documents/notes.openapi.json',
    credentials: [{ kind: 'none' }],
  },
  'https://api.notes.example.com/v1',
);

const notesElsewhere = providerOf({
  ...notesBeside.entry,
  document: 'https://notes.example.com/openapi.json',
});

const renamed = providerListOf(issues, providerOf(ledgers), notesBeside);

describe('a provider found by one of its names', () => {
  it('is found by its name, and by each other name its entry declares', () => {
    expect(['issues', 'tracker', 'tickets', 'ledgers'].map((name) => providerFoundBy(renamed, name))).toEqual([
      issues,
      issues,
      issues,
      renamed.providers[1],
    ]);
    expect(Result.getOrThrow(providerNamed(renamed, 'tickets'))).toBe(issues);
  });

  it('is none for a name no entry declares, or for a server given by hand, and refused by that name', () => {
    expect([providerFoundBy(renamed, 'crm'), providerFoundBy(renamed, null)]).toEqual([undefined, undefined]);
    expect(Result.getOrThrow(Result.flip(providerNamed(renamed, 'crm')))).toEqual([
      { pointer: '/provider', detail: 'There is no provider named crm here' },
    ]);
  });

  it('is the provider whose name it is before any whose other name it is, in a list nothing checked', () => {
    const named = providerOf(tracker);

    expect(providerFoundBy(providerListOf(issues, named), 'tracker')).toBe(named);
  });

  it('answers its render target, its conversations and its events by any of its names', () => {
    expect(['tracker', 'issues'].map((name) => rendersOf(renamed, name))).toEqual(['cards', 'cards']);
    expect(conversationsOf(renamed, 'tickets')).toEqual({ tell: 'all', reply });
    expect(eventDestinationOf(renamed, 'tracker', 'webhook')).toMatchObject({ type: 'webhook', per: 'app' });
  });
});

describe('a provider and its document as a connection recorded them, read as the list names them now', () => {
  it('are read under the name of the provider found by the name recorded, its document beside the entries its own now', () => {
    expect(asNamedIn(renamed, { provider: 'tracker', document: undefined })).toEqual({
      provider: 'issues',
      document: undefined,
    });
    expect(asNamedIn(renamed, { provider: 'jottings', document: 'documents/jottings.openapi.json' })).toEqual({
      provider: 'notes',
      document: 'documents/notes.openapi.json',
    });
  });

  it('keep a document named by its address, and a document beside the entries where the provider now names one by its address', () => {
    expect(asNamedIn(renamed, { provider: 'jottings', document: 'https://jottings.example.com/openapi.json' })).toEqual(
      { provider: 'notes', document: 'https://jottings.example.com/openapi.json' },
    );
    expect(
      asNamedIn(providerListOf(notesElsewhere), { provider: 'jottings', document: 'documents/jottings.openapi.json' }),
    ).toEqual({ provider: 'notes', document: 'documents/jottings.openapi.json' });
  });

  it('are kept as recorded where the name recorded is the provider’s own or no provider’s', () => {
    const asRecorded: readonly NamedAs[] = [
      { provider: 'notes', document: 'documents/jottings.openapi.json' },
      { provider: 'crm', document: 'documents/crm.openapi.json' },
    ];

    expect(asRecorded.map((recorded) => asNamedIn(renamed, recorded))).toEqual(asRecorded);
  });
});

describe('the providers whoever runs the runtime adds, beside shipped ones that have other names', () => {
  it('take the place of each shipped one found by any of their names', () => {
    const shipped = providerListOf(issues, providerOf(ledgers), providerOf(metrics));
    const ownTickets = decodedEntry({ ...tracker, name: 'tickets' });
    const ownLedgers = decodedEntry({ ...tracker, name: 'books', aliases: ['ledgers'] });

    expect(joinedProviders(shipped, [ownTickets]).providers.map(({ entry }) => entry.name)).toEqual([
      'ledgers',
      'metrics',
      'tickets',
    ]);
    expect(joinedProviders(shipped, [ownLedgers]).providers.map(({ entry }) => entry.name)).toEqual([
      'books',
      'issues',
      'metrics',
    ]);
    expect(joinedProviders(fixtureProviders, []).providers).toEqual(fixtureProviders.providers);
  });
});

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProviderEntrySchema } from '../entry/provider-entry.ts';
import {
  eventDestinationOf,
  joinedProviders,
  permissionsOf,
  type ProviderEntry,
  providerNamed,
  providersShippedRoots,
  readProviders,
  rendersOf,
  requestOriginsOf,
} from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { intoAQueue, ofEachSubscription, overASocket, trackerOverASocket } from '../testing/event-destinations.ts';
import { tracker } from '../testing/index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

describe('the shipped providers whose tools handle money', () => {
  it('are Stripe alone, whose tools refund and pay out', () => {
    expect(
      shipped.providers.filter(({ entry }) => entry.handles_money === true).map(({ entry }) => entry.name),
    ).toEqual(['stripe']);
  });
});

const ways = shipped.providers.flatMap(({ entry }) => entry.credentials);

describe('the ways of the shipped providers', () => {
  it('connect through no gateway, so no connection made from a shipped entry is made through one', () => {
    expect(ways.filter(({ gateway }) => gateway !== undefined)).toEqual([]);
  });

  it('state, on each way that acts as an account at the service, the kinds of account it may act as', () => {
    const unstated = ways.filter((way) => way.account_types === undefined).map((way) => permissionsOf(way));
    expect(unstated).not.toContain('delegated');
  });
});

describe('the shipped providers a message through which can be a card', () => {
  it('are the Slack Bot entry alone, naming the render target slack', () => {
    expect(
      shipped.providers
        .filter(({ entry }) => entry.renders !== undefined)
        .map(({ entry }) => [entry.name, entry.renders]),
    ).toEqual([['slack-bot', 'slack']]);
  });

  it('answer by the name of the provider, and nothing for a provider that renders none or a server given by hand', () => {
    expect(['slack-bot', 'zoom', 'unknown', null].map((provider) => rendersOf(shipped, provider))).toEqual([
      'slack',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('are taken from an entry of whoever runs the runtime too', () => {
    const own = decodedEntry({ ...tracker, renders: 'cards' });

    expect(rendersOf(joinedProviders(shipped, [own]), 'tracker')).toBe('cards');
  });
});

const declaring = shipped.providers.filter(({ entry }) => entry.events !== undefined);

const hearing = (name: string) =>
  joinedProviders(shipped, [
    Schema.decodeUnknownSync(ProviderEntrySchema)({
      ...trackerOverASocket,
      name,
      events: { destinations: [overASocket] },
    }),
  ]);

function sentAndTakenBy({ name, events, credentials }: ProviderEntry) {
  return [
    name,
    (events?.destinations ?? []).map(({ type, credential }) => [type, credential]),
    credentials.flatMap(({ app_credentials: named = [] }) => named.map((each) => each.name)),
  ];
}

describe('the events parts of the shipped providers', () => {
  it('are written by GitHub and Slack Bot alone, so a provider of any other service that hears its events is one whoever runs the runtime adds', () => {
    expect(declaring.map(({ entry }) => entry.name)).toEqual(['github', 'slack-bot']);
  });

  it("are GitHub's, a webhook made for each subscription by a request to its API, where its credential goes", () => {
    const github = Result.getOrThrow(providerNamed(shipped, 'github'));

    expect(github.entry.events?.destinations.map(({ type, per }) => [type, per])).toEqual([
      ['webhook', 'subscription'],
    ]);
    expect(requestOriginsOf(github.entry)).toEqual(['https://api.github.com']);
  });

  it("are Slack Bot's, a socket opened with the app credential its way of a key takes, pinged every 30 seconds", () => {
    const slackBot = Result.getOrThrow(providerNamed(shipped, 'slack-bot'));

    expect(sentAndTakenBy(slackBot.entry)).toEqual([
      'slack-bot',
      [['websocket', 'app_level_token']],
      ['app_level_token'],
    ]);
    expect(eventDestinationOf(shipped, 'slack-bot', 'websocket')?.heartbeat_seconds).toBe(30);
  });
});

describe('the destination of a provider', () => {
  it('is answered for a provider and a type it declares', () => {
    expect(eventDestinationOf(hearing('team-chat'), 'team-chat', 'websocket')).toMatchObject({ type: 'websocket' });
  });

  it('is answered for a type it does not declare, a server added by hand or a provider unknown, not at all', () => {
    const joined = hearing('team-chat');
    const asked: readonly (readonly [string | null, 'webhook' | 'websocket' | 'queue'])[] = [
      ['team-chat', 'webhook'],
      ['team-chat', 'queue'],
      [null, 'webhook'],
      ['slack-bot', 'webhook'],
      ['unknown', 'webhook'],
    ];

    expect(asked.map(([provider, type]) => eventDestinationOf(joined, provider, type))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('is that of a provider whoever runs the runtime adds, in place of a shipped one of the same name', () => {
    const joined = hearing('slack-bot');

    expect(eventDestinationOf(joined, 'slack-bot', 'websocket')?.open).toEqual(overASocket.open);
    expect(eventDestinationOf(shipped, 'slack-bot', 'websocket')?.open).toEqual({
      method: 'POST',
      url: 'https://slack.com/api/apps.connections.open',
      address: '/url',
    });
  });
});

function sending(...destinations: readonly unknown[]): ProviderEntry {
  return decodedEntry({ ...trackerOverASocket, events: { destinations } });
}

describe('the origins of the requests a provider declares', () => {
  it('are the origin each call of a subscription written as a request is written out to, each once', () => {
    const renew = { method: 'PATCH', url: 'https://hooks.tracker.example.com/{{ subscription.id }}' };

    expect(requestOriginsOf(sending({ ...ofEachSubscription, renew, lease_seconds: 3600 }))).toEqual([
      'https://api.tracker.example.com',
      'https://hooks.tracker.example.com',
    ]);
  });

  it("are none for calls that are tools, for a socket, whose request carries the app's value, and for an entry that hears nothing", () => {
    expect([
      requestOriginsOf(sending(intoAQueue)),
      requestOriginsOf(sending(overASocket)),
      requestOriginsOf(tracker),
    ]).toEqual([[], [], []]);
  });

  it.each([
    ['a port past 65535', 'https://api.tracker.example.com:99999/hooks'],
    ['an IPv4 address with a part past 255', 'https://999.1.1.1/hooks'],
    ['an IPv4 address written as one number past 32 bits', 'https://0x100000000/hooks'],
  ])('are none for a URL the format takes that no URL parser reads, %s, so no credential goes to it', (_kind, url) => {
    expect(requestOriginsOf(subscribingAt(url))).toEqual([]);
  });

  it('are at most the origin a URL parser reads of an IDNA label it may refuse, and reading them never throws', () => {
    const url = 'https://xn--a.example.com/hooks';

    expect(['https://xn--a.example.com']).toEqual(expect.arrayContaining([...requestOriginsOf(subscribingAt(url))]));
  });
});

function subscribingAt(url: string): ProviderEntry {
  const subscribe = { ...ofEachSubscription.subscribe, url };
  const unsubscribe = { ...ofEachSubscription.unsubscribe, url: `${url}/{{ subscription.id }}` };
  return sending({ ...ofEachSubscription, subscribe, unsubscribe });
}

const readsThroughPost: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['adobe-analytics', ['runReport']],
  [
    'amazon-ads',
    [
      'QueryAdvertiserAccount',
      'QueryCampaign',
      'QueryAdGroup',
      'QueryAd',
      'QueryTarget',
      'QueryRecommendation',
      'AdsApiv1RetrieveReport',
    ],
  ],
  ['campaign-manager-360', ['dfareporting.dimensionValues.query', 'dfareporting.reports.compatibleFields.query']],
  [
    'google-ads',
    [
      'googleads.customers.googleAds.search',
      'googleads.customers.googleAds.searchStream',
      'googleads.googleAdsFields.search',
    ],
  ],
  [
    'google-analytics',
    [
      'analyticsdata.properties.runReport',
      'analyticsdata.properties.runPivotReport',
      'analyticsdata.properties.batchRunReports',
      'analyticsdata.properties.batchRunPivotReports',
      'analyticsdata.properties.runRealtimeReport',
      'analyticsdata.properties.checkCompatibility',
      'analyticsdata.properties.audienceExports.query',
    ],
  ],
  ['google-analytics-admin', ['analyticsadmin.properties.runAccessReport']],
  ['google-search-console', ['webmasters.searchanalytics.query', 'searchconsole.urlInspection.index.inspect']],
  ['search-ads-360', ['searchads360.customers.searchAds360.search', 'searchads360.searchAds360Fields.search']],
];

describe('the marks of the shipped providers', () => {
  it('mark reads the operations of an HTTP API that only read through POST, and mark no tool acts, which its method marks', () => {
    const marking = shipped.providers.filter(({ entry }) => entry.marks !== undefined);

    expect(marking.map(({ entry }) => [entry.name, entry.type, entry.marks])).toEqual(
      readsThroughPost.map(([name, reads]: readonly [string, readonly string[]]) => [name, 'openapi', { reads }]),
    );
  });
});

const bareVerbs: ReadonlySet<string> = new Set([
  'Act',
  'Add',
  'Ask',
  'Change',
  'Create',
  'Delete',
  'Keep',
  'Manage',
  'Post',
  'Read',
  'Run',
  'Search',
  'See',
  'Send',
]);

const personalPronouns = /\b(?:I|me|my|mine|we|us|our|ours|you|your|yours|he|him|his|she|her|hers)\b/iu;

interface SaidScope {
  readonly provider: string;
  readonly scope: string;
  readonly says: string | undefined;
}

interface Said {
  readonly scope?: string | undefined;
  readonly says?: Readonly<Record<string, string>> | undefined;
}

function scopesSaidBy(provider: string, { scope, says = {} }: Said): readonly SaidScope[] {
  return (scope === undefined ? [] : scope.split(' ')).map((each) => ({ provider, scope: each, says: says[each] }));
}

function saidScopesOf({ name, credentials }: ProviderEntry): readonly SaidScope[] {
  return credentials.flatMap((way) => [
    ...scopesSaidBy(name, way),
    ...(way.more ?? []).flatMap((group) => scopesSaidBy(name, group)),
  ]);
}

function opensWithABareVerb(sentence: string): boolean {
  const [verb = ''] = sentence.split(/[ ,]/u);
  return sentence.length <= 120 && bareVerbs.has(verb) && sentence.endsWith('.');
}

function breaksTheRule({ says = '' }: SaidScope): boolean {
  return !opensWithABareVerb(says) || personalPronouns.test(says);
}

const saidScopes = shipped.providers.flatMap(({ entry }) => saidScopesOf(entry));

describe('the words of the scopes the shipped providers ask', () => {
  it('say every scope in at most 120 characters, opening with a bare verb and naming no person by a pronoun', () => {
    expect(saidScopes.filter((said) => breaksTheRule(said))).toEqual([]);
    expect(saidScopes).toHaveLength(111);
  });
});

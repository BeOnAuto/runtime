import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  matchesKeyPattern,
  providersShippedRoots,
  readProviders,
  type CredentialWay,
  type ProviderEntry,
} from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

function waysOfAKeyOf({ name, credentials }: ProviderEntry): readonly (readonly [string, CredentialWay])[] {
  return credentials.filter(({ kind }) => kind === 'secret').map((way) => [name, way]);
}

const waysOfAKey = shipped.providers.flatMap(({ entry }) => waysOfAKeyOf(entry));

function shownOf([provider, way]: readonly [string, CredentialWay]) {
  const page = way.key_page === undefined ? undefined : new URL(way.key_page);
  return [provider, way.description, page?.origin, page?.pathname, way.example, way.pattern];
}

function linkedIn([provider, way]: readonly [string, CredentialWay]): readonly (string | boolean)[] {
  const { instructions = '', key_page: keyPage = '', example = '' } = way;
  return [provider, instructions.includes(`](${keyPage})`), instructions.includes(example.replace('…', ''))];
}

function furtherOf([provider, way]: readonly [string, CredentialWay]) {
  const further = (way.app_credentials ?? []).map(({ name, description, key_page: keyPage, example, pattern }) => [
    name,
    description,
    keyPage,
    example,
    pattern,
  ]);
  return [provider, way.test?.tool, further];
}

const slackKeyPage = new URL(waysOfAKey.find(([provider]) => provider === 'slack-bot')?.[1].key_page ?? '');

const slackManifest: unknown = JSON.parse(slackKeyPage.searchParams.get('manifest_json') ?? '');

const shownOfEachKey = [
  ['apollo-graphos-agent-services', 'API key', 'https://constellation.apollographql.com', '/', undefined, undefined],
  ['atlassian', 'API token', 'https://admin.atlassian.com', '/', undefined, undefined],
  ['buffer', 'Buffer API key', 'https://publish.buffer.com', '/settings/api', undefined, undefined],
  [
    'github',
    'GitHub fine-grained personal access token',
    'https://github.com',
    '/settings/personal-access-tokens/new',
    'github_pat_…',
    '^github_pat_.+$',
  ],
  ['profound', 'Profound API key', 'https://platform.tryprofound.com', '/', undefined, undefined],
  ['slack-bot', 'Slack bot token', 'https://api.slack.com', '/apps', 'xoxb-…', '^xoxb-.+$'],
  ['stripe', 'API key', 'https://dashboard.stripe.com', '/apikeys', undefined, undefined],
];

describe('the ways of a key of the shipped providers', () => {
  it('each name the key, the page where it is made and, where the vendor documents its start, the format of a key', () => {
    expect(waysOfAKey.map((each) => shownOf(each))).toEqual(shownOfEachKey);
  });

  it('link their key page in their instructions, except one that makes an app, and name the start of a key a pattern holds it to', () => {
    expect(waysOfAKey.map((each) => linkedIn(each))).toEqual([
      ['apollo-graphos-agent-services', true, true],
      ['atlassian', true, true],
      ['buffer', true, true],
      ['github', true, true],
      ['profound', true, true],
      ['slack-bot', false, true],
      ['stripe', true, true],
    ]);
  });

  it('test the key with a tool where the vendor offers one, and take app credentials only where an entry opens a socket', () => {
    expect(waysOfAKey.map((each) => furtherOf(each))).toEqual([
      ['apollo-graphos-agent-services', undefined, []],
      ['atlassian', undefined, []],
      ['buffer', undefined, []],
      ['github', undefined, []],
      ['profound', undefined, []],
      ['slack-bot', 'auth_test', [['app_level_token', 'Slack app-level token', undefined, 'xapp-…', '^xapp-.+$']]],
      ['stripe', undefined, []],
    ]);
  });
});

const [, bufferKey] = Option.getOrThrow(Option.fromNullishOr(waysOfAKey.find(([provider]) => provider === 'buffer')));

describe('the way of a key of Buffer', () => {
  it('decodes with the page where the key is made and the label of the button that opens it, and takes a service account', () => {
    expect([bufferKey.key_page, bufferKey.key_page_title === undefined, bufferKey.account_types]).toEqual([
      'https://publish.buffer.com/settings/api',
      false,
      ['service', 'personal'],
    ]);
  });
});

function stepsShownOf(provider: string) {
  const [, way] = Option.getOrThrow(Option.fromNullishOr(waysOfAKey.find(([named]) => named === provider)));
  const { key_page: keyPage, key_page_title: keyPageTitle, steps } = way;
  return [
    provider,
    keyPage,
    keyPageTitle === undefined,
    steps?.key_page === undefined,
    steps?.pages?.map(({ page }) => page),
    steps?.key === undefined,
  ];
}

describe('the ways of a key of Atlassian and Stripe', () => {
  it('decode with the page where the key is made, the label of the button that opens it, and the steps of the page', () => {
    expect(['atlassian', 'stripe'].map((provider) => stepsShownOf(provider))).toEqual([
      [
        'atlassian',
        'https://admin.atlassian.com',
        false,
        false,
        ['https://admin.atlassian.com', 'https://admin.atlassian.com'],
        false,
      ],
      ['stripe', 'https://dashboard.stripe.com/apikeys', false, false, undefined, false],
    ]);
  });
});

function keyFileStepsOf({ name, credentials }: ProviderEntry) {
  return credentials
    .filter(({ kind }) => kind === 'jwt_bearer')
    .map(({ key_page: keyPage, key_page_title: keyPageTitle, steps }) => [
      name,
      keyPage,
      keyPageTitle === undefined,
      steps?.key_page === undefined,
      steps?.pages?.map(({ page, page_title: pageTitle }) => [page, pageTitle === undefined]),
      steps?.key === undefined,
    ]);
}

const serviceAccounts = 'https://console.cloud.google.com/iam-admin/serviceaccounts';

function stepsOfAKeyFile(name: string, pages: readonly string[]) {
  return [name, serviceAccounts, false, false, pages.map((page) => [page, false]), false];
}

describe('the ways of a key file of the shipped providers', () => {
  it('decode with the page where the service account is made, the label of its button, and the steps of the page, each with the page it opens and the label of the button that opens it', () => {
    expect(shipped.providers.flatMap(({ entry }) => keyFileStepsOf(entry))).toEqual([
      stepsOfAKeyFile('campaign-manager-360', ['https://campaignmanager.google.com/']),
      stepsOfAKeyFile('display-video-360', ['https://displayvideo.google.com/']),
      [
        'github',
        'https://github.com/settings/organizations',
        false,
        false,
        [
          ['https://github.com/settings/organizations', false],
          ['https://github.com/settings/organizations', false],
        ],
        false,
      ],
      stepsOfAKeyFile('gmail', ['https://admin.google.com/ac/owl/domainwidedelegation']),
      stepsOfAKeyFile('google-ads', [
        'https://console.cloud.google.com/google/ads-apis/overview',
        'https://ads.google.com/',
      ]),
      stepsOfAKeyFile('google-analytics', ['https://analytics.google.com/']),
      stepsOfAKeyFile('google-analytics-admin', ['https://analytics.google.com/']),
      stepsOfAKeyFile('google-docs', ['https://drive.google.com/']),
      stepsOfAKeyFile('google-sheets', ['https://drive.google.com/']),
      stepsOfAKeyFile('google-slides', ['https://drive.google.com/']),
      stepsOfAKeyFile('youtube-analytics', ['https://studio.youtube.com/']),
    ]);
  });
});

describe('the patterns of the keys of the shipped providers', () => {
  it('take the keys their vendors document, and refuse a key of another kind', () => {
    expect([
      matchesKeyPattern('^github_pat_.+$', 'github_pat_11ABC_def'),
      matchesKeyPattern('^github_pat_.+$', 'ghp_11ABC'),
      matchesKeyPattern('^xoxb-.+$', 'xoxb-1-2-abc'),
      matchesKeyPattern('^xoxb-.+$', 'xoxp-1-2-abc'),
      matchesKeyPattern('^xapp-.+$', 'xapp-1-A0APP-2-abc'),
      matchesKeyPattern('^xapp-.+$', 'xoxb-1-2-abc'),
    ]).toEqual([true, false, true, false, true, false]);
  });
});

const anyWords: unknown = expect.any(String);

describe('the page where the Slack bot token is made', () => {
  it('creates an app named Auto from a manifest, shown as an agent people can message, with the bot scopes, events and button clicks it needs', () => {
    expect(slackKeyPage.searchParams.get('new_app')).toBe('1');
    expect(slackManifest).toEqual({
      display_information: { name: 'Auto' },
      features: {
        app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
        bot_user: { display_name: 'Auto' },
        agent_view: { agent_description: anyWords },
      },
      oauth_config: {
        scopes: {
          bot: [
            'channels:read',
            'channels:history',
            'users:read',
            'chat:write',
            'reactions:read',
            'reactions:write',
            'groups:read',
            'groups:history',
            'app_mentions:read',
            'im:history',
            'users:read.email',
            'assistant:write',
          ],
        },
      },
      settings: {
        event_subscriptions: { bot_events: ['message.channels', 'message.groups', 'app_mention', 'message.im'] },
        interactivity: { is_enabled: true },
        socket_mode_enabled: true,
      },
    });
  });
});

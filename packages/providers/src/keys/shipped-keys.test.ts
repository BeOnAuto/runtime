import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
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

describe('the ways of a key of the shipped providers', () => {
  it('each name the key, the page where it is made and, where the vendor documents its start, the format of a key', () => {
    expect(waysOfAKey.map((each) => shownOf(each))).toEqual([
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
    ]);
  });

  it('link their key page in their instructions, except one that makes an app, and name the start of a key a pattern holds it to', () => {
    expect(waysOfAKey.map((each) => linkedIn(each))).toEqual([
      ['buffer', true, true],
      ['github', true, true],
      ['profound', true, true],
      ['slack-bot', false, true],
    ]);
  });

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

  it('test the key with a tool where the vendor offers one, and take app credentials only where an entry opens a socket', () => {
    expect(waysOfAKey.map((each) => furtherOf(each))).toEqual([
      ['buffer', undefined, []],
      ['github', undefined, []],
      ['profound', undefined, []],
      ['slack-bot', 'auth_test', [['app_level_token', 'Slack app-level token', undefined, 'xapp-…', '^xapp-.+$']]],
    ]);
  });
});

describe('the page where the Slack bot token is made', () => {
  it('creates an app named Auto from a manifest, with the bot scopes of its tools and the events of its socket', () => {
    expect(slackKeyPage.searchParams.get('new_app')).toBe('1');
    expect(slackManifest).toEqual({
      display_information: { name: 'Auto' },
      features: { bot_user: { display_name: 'Auto' } },
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
          ],
        },
      },
      settings: {
        event_subscriptions: { bot_events: ['message.channels', 'message.groups'] },
        socket_mode_enabled: true,
      },
    });
  });
});

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
  return [provider, way.description, way.key_page, way.example, way.pattern];
}

function linkedIn([, way]: readonly [string, CredentialWay]): readonly boolean[] {
  const { instructions = '', key_page: keyPage = '', example = '' } = way;
  return [instructions.includes(`](${keyPage})`), instructions.includes(example.replace('…', ''))];
}

describe('the ways of a key of the shipped providers', () => {
  it('each name the key, the page where it is made and, where the vendor documents its start, the format of a key', () => {
    expect(waysOfAKey.map((each) => shownOf(each))).toEqual([
      ['buffer', 'Buffer API key', 'https://publish.buffer.com/settings/api', undefined, undefined],
      [
        'github',
        'GitHub fine-grained personal access token',
        'https://github.com/settings/personal-access-tokens/new',
        'github_pat_…',
        '^github_pat_.+$',
      ],
      ['profound', 'Profound API key', 'https://platform.tryprofound.com/', undefined, undefined],
      ['slack-bot', 'Slack bot token', 'https://api.slack.com/apps', 'xoxb-…', '^xoxb-.+$'],
    ]);
  });

  it('link their key page in their instructions, which name the start of a key a pattern holds it to', () => {
    expect(waysOfAKey.map((each) => linkedIn(each))).toEqual(waysOfAKey.map(() => [true, true]));
  });

  it('take the keys their vendors document, and refuse a key of another kind', () => {
    expect([
      matchesKeyPattern('^github_pat_.+$', 'github_pat_11ABC_def'),
      matchesKeyPattern('^github_pat_.+$', 'ghp_11ABC'),
      matchesKeyPattern('^xoxb-.+$', 'xoxb-1-2-abc'),
      matchesKeyPattern('^xoxb-.+$', 'xoxp-1-2-abc'),
    ]).toEqual([true, false, true, false]);
  });
});

import { describe, expect, it } from 'vitest';

import { hostAlternativesOf, isPinnableTemplate, pinnedTemplateShape } from '../index.ts';
import { problemsOf } from '../testing/entry-problems.ts';
import { ledgers, providerOf, regions, tracker } from '../testing/fixture-providers.ts';

const unpinned =
  'Expected an https URL, or an http URL on a loopback address, written out up to its host, with each placeholder in its place';

function choice(value: string, apiHost: string) {
  return { value, title: value, sets: { api_host: apiHost } };
}

function regionsSetting(...apiHosts: readonly string[]) {
  const region = { description: 'The region', choices: apiHosts.map((apiHost, index) => choice(`r${index}`, apiHost)) };
  return { ...regions, placeholders: { ...regions.placeholders, region } };
}

describe('an address of an entry', () => {
  it('is never a placeholder, whole or in its scheme, and writes out its scheme and :// before its host', () => {
    expect([
      problemsOf({ ...tracker, url: '{site}' }),
      problemsOf({ ...tracker, url: '{site}://tracker.example.com/mcp' }),
      problemsOf({ ...tracker, url: 'https:{site}.tracker.example.com/mcp' }),
      problemsOf({ ...tracker, url: 'https://{site}@tracker.example.com/mcp' }),
      problemsOf({ ...tracker, url: 'https://{site}.tracker.example.com:443/mcp' }),
    ]).toEqual([[['/url', unpinned]], [['/url', unpinned]], [['/url', unpinned]], [['/url', unpinned]], []]);
  });

  it('is judged with each placeholder in its place, an issuer and a base URL as the server is', () => {
    expect(
      problemsOf({
        ...ledgers,
        base_url: '{tenant}',
        credentials: [{ kind: 'client_credentials', issuer: '{tenant}://auth.ledgers.example.com' }],
      }),
    ).toEqual([
      ['/base_url', unpinned],
      ['/credentials/0/issuer', unpinned],
    ]);
  });

  it('is judged with what each choice sets in its place, so the host of every address an entry the schema takes is read', () => {
    const taken = regionsSetting('api-na.regions.example.com', 'api-eu.regions.example.com');

    expect([problemsOf(regionsSetting('api-na.regions.example.com', 'api eu')), problemsOf(taken)]).toEqual([
      [['/base_url', unpinned]],
      [],
    ]);
    expect(providerOf(taken).entry.credentials.map((way) => hostAlternativesOf(providerOf(taken), way))).toEqual([
      [['api-na.regions.example.com'], ['api-eu.regions.example.com']],
    ]);
  });
});

describe('an address written with placeholders and nothing to place in them', () => {
  it('is judged by the rule of an address of an entry, in its words', () => {
    expect(
      [
        'https://{tenant}.auth.example.com',
        'https://login.example.net/{tenant}/v2.0',
        'http://127.0.0.1:8443/{tenant}',
        '{tenant}://auth.example.com',
        'http://{tenant}.auth.example.com',
        'https://{tenant}@auth.example.com',
      ].map((template) => isPinnableTemplate(template)),
    ).toEqual([true, true, true, false, false, false]);
    expect(pinnedTemplateShape).toBe(unpinned);
  });
});

describe('the document of an entry', () => {
  it('is an address, or the document beside the entries named for the provider, and no other path', () => {
    const beside = { ...ledgers, document: 'documents/ledgers.openapi.json' };

    expect([
      problemsOf(beside),
      problemsOf({ ...beside, document: 'documents/other.openapi.json' }),
      problemsOf({ ...beside, document: '{tenant}' }),
    ]).toEqual([
      [],
      [
        [
          '/document',
          `${unpinned}, or documents/ledgers.openapi.json, the document beside the entries named for the provider`,
        ],
      ],
      [
        [
          '/document',
          `${unpinned}, or documents/ledgers.openapi.json, the document beside the entries named for the provider`,
        ],
      ],
    ]);
  });
});

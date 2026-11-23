import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { hostAlternativesOf, isPinnableTemplate, pinnedTemplateShape } from '../index.ts';
import { problemsOf, refusedAt } from '../testing/entry-problems.ts';
import { ledgers, providerOf, regions, tracker } from '../testing/fixture-providers.ts';
import {
  agentServerAddress,
  agents,
  asARegisteredClient,
  asAServiceAccount,
  mail,
  signingInToMail,
} from '../testing/own-app-providers.ts';
import { limitationSchemaOf, mostLimitationCharacters } from './credential-ways.ts';

const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['revoked'] };

describe('the one sentence of an entry', () => {
  it('is taken of 1 to 120 characters, beside the description, and left out where the entry gives none', () => {
    expect([
      problemsOf({ ...tracker, summary: 'a'.repeat(120) }),
      problemsOf({ ...tracker, summary: 'a' }),
      problemsOf(tracker),
    ]).toEqual([[], [], []]);
  });

  it('is refused empty and past 120 characters', () => {
    expect([
      problemsOf({ ...tracker, summary: '' }).map(([path]) => path),
      problemsOf({ ...tracker, summary: 'a'.repeat(121) }).map(([path]) => path),
    ]).toEqual([['/summary'], ['/summary']]);
  });
});

describe('the sentence of what a way cannot do', () => {
  it.each([
    [2, 'a', true],
    [2, 'ab', true],
    [2, '', false],
    [2, 'abc', false],
  ])('is taken in at most %i characters, as %j: %s', (most, limitation, taken) => {
    expect(Result.isSuccess(Schema.decodeUnknownResult(limitationSchemaOf(most))(limitation))).toBe(taken);
  });

  it('is taken of 1 to 160 characters, as the runtime ships, on a way of each kind that sends a credential', () => {
    const [aKey] = tracker.credentials;
    const [aClient] = ledgers.credentials;
    const said = { limitation: 'a' };

    expect(mostLimitationCharacters).toBe(160);
    expect([
      problemsOf({ ...tracker, credentials: [{ ...aKey, limitation: 'a'.repeat(160) }] }),
      problemsOf({ ...ledgers, credentials: [{ ...aClient, ...said }] }),
      problemsOf({
        ...mail,
        credentials: [
          { ...signingInToMail, ...said },
          { ...asAServiceAccount, ...said },
        ],
      }),
    ]).toEqual([[], [], []]);
  });

  it('is refused empty, past 160 characters and on a way that sends no credential', () => {
    const [aKey, noCredential] = tracker.credentials;
    const onNoCredential = problemsOf({ ...tracker, credentials: [aKey, { ...noCredential, limitation: 'a' }] });

    expect([
      refusedAt({ limitation: '' }),
      refusedAt({ limitation: 'a'.repeat(161) }),
      onNoCredential.map(([path]) => path),
    ]).toEqual([['/credentials/0/limitation'], ['/credentials/0/limitation'], ['/credentials/1/limitation']]);
  });
});

describe('the failure codes of an entry', () => {
  it('are taken for an HTTP API, with their pointers into the answer and each code once, and for no MCP server', () => {
    expect(problemsOf({ ...ledgers, failure_codes: failureCodes })).toEqual([]);
    expect(
      problemsOf({ ...ledgers, failure_codes: { ...failureCodes, succeeded: 'ok', rate_limited: ['revoked'] } }),
    ).toEqual([
      ['/failure_codes/succeeded', 'Expected a JSON pointer into the answer, such as /ok'],
      ['/failure_codes/rate_limited/0', 'revoked is named twice, and a code means one failure'],
    ]);
    expect(problemsOf({ ...tracker, failure_codes: failureCodes })).toEqual([
      ['/failure_codes', 'Expected no failure_codes: an mcp provider takes url'],
    ]);
  });
});

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
  it('is never a placeholder in its scheme, nor one whole but of format uri, and writes out its scheme and :// before its host', () => {
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

function wholeAddressOnly(name: string): string {
  return `Holds {${name}}, a placeholder of format uri, which stands only as the whole url of an mcp provider`;
}

const agentsCalledAt = {
  name: 'agents',
  title: agents.title,
  description: agents.description,
  website: agents.website,
  placeholders: { address: agentServerAddress },
  credentials: [asARegisteredClient],
};

const mcpAt = { type: 'mcp', url: 'https://agents.example.com/mcp' };

const placedElsewhere: readonly (readonly [string, Readonly<Record<string, unknown>>, string])[] = [
  ['before a path of the address', { type: 'mcp', url: '{address}/mcp' }, '/url'],
  ['after the scheme of the address', { type: 'mcp', url: 'https://{address}' }, '/url'],
  ['in the host of the address', { type: 'mcp', url: 'https://{address}.example.com/mcp' }, '/url'],
  ['in the path of the address', { type: 'mcp', url: 'https://agents.example.com/{address}' }, '/url'],
  ['in a header', { ...mcpAt, headers: { 'X-Server': '{address}' } }, '/headers/X-Server'],
  ['as the document of an HTTP API', { type: 'openapi', document: '{address}' }, '/document'],
  [
    'as the base address of an HTTP API',
    { type: 'openapi', document: 'https://agents.example.com/openapi.json', base_url: '{address}' },
    '/base_url',
  ],
  [
    'as the issuer of a way',
    { ...mcpAt, credentials: [{ kind: 'client_credentials', issuer: '{address}' }] },
    '/credentials/0/issuer',
  ],
];

const takenNowhere: readonly (readonly [string, Readonly<Record<string, unknown>>, string])[] = [
  ['a pattern', { pattern: '^https://.+$' }, '/placeholders/address/pattern'],
  ['required', { required: false }, '/placeholders/address/required'],
  ['choices', { choices: [{ value: 'https://a.example.com', title: 'A' }] }, '/placeholders/address/choices'],
];

const withoutAnExample = {
  title: agentServerAddress.title,
  description: agentServerAddress.description,
  format: agentServerAddress.format,
};

const examplesRefused: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
  ['none', withoutAnExample],
  ['one that is no address', { ...agentServerAddress, example: 'agents.acme.example.com/mcp' }],
  ['one that is not https', { ...agentServerAddress, example: 'http://agents.acme.example.com/mcp' }],
];

describe('a placeholder of format uri', () => {
  it('stands as the whole url of an mcp provider, the one place it is taken', () => {
    expect(problemsOf(agents)).toEqual([]);
  });

  it.each(placedElsewhere)('is refused %s', (_case, fields, path) => {
    expect(problemsOf({ ...agentsCalledAt, ...fields })).toContainEqual([path, wholeAddressOnly('address')]);
  });

  it('is refused in the issuer of a way that asks it as its own value', () => {
    const way = { kind: 'client_credentials', issuer: '{server}', placeholders: { server: agentServerAddress } };

    expect(problemsOf({ ...agentsCalledAt, ...mcpAt, placeholders: {}, credentials: [way] })).toContainEqual([
      '/credentials/0/issuer',
      wholeAddressOnly('server'),
    ]);
  });

  it.each(takenNowhere)(
    'takes no %s, since its value is checked as an address given by hand',
    (_case, fields, path) => {
      expect(problemsOf({ ...agents, placeholders: { address: { ...agentServerAddress, ...fields } } })).toContainEqual(
        [path, expect.any(String)],
      );
    },
  );

  it.each(examplesRefused)('takes an example that is an https URL, refusing %s', (_case, address) => {
    expect(problemsOf({ ...agents, placeholders: { address } })).toEqual([
      ['/placeholders/address/example', expect.any(String)],
    ]);
  });
});

const referencesSent: readonly (readonly [string, Readonly<Record<string, unknown>>, string])[] = [
  ['as a header value', { headers: { 'X-Token': '${OPS_TOKEN}' } }, '/headers/X-Token'],
  ['inside a header value', { headers: { 'X-Token': 'Token ${OPS_TOKEN}' } }, '/headers/X-Token'],
  ['with the env: prefix', { headers: { 'X-Token': '${env:OPS_TOKEN}' } }, '/headers/X-Token'],
  ['with a default', { headers: { 'X-Region': '${OPS_REGION:-eu}' } }, '/headers/X-Region'],
];

describe('a reference to an environment variable in an entry whose url a person gives whole', () => {
  it.each(referencesSent)(
    'is refused %s, since its value would be sent to the address the person gives',
    (_case, fields, path) => {
      expect(problemsOf({ ...agentsCalledAt, ...fields, type: 'mcp', url: '{address}' })).toEqual([
        [path, expect.any(String)],
      ]);
    },
  );

  it.each(referencesSent)('is taken %s where the entry writes its own address', (_case, fields) => {
    expect(problemsOf({ ...agentsCalledAt, ...mcpAt, ...fields, placeholders: {} })).toEqual([]);
  });

  it('is no escaped $, which is sent as written', () => {
    expect(problemsOf({ ...agentsCalledAt, type: 'mcp', url: '{address}', headers: { 'X-Currency': 'US$$' } })).toEqual(
      [],
    );
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
  it('is an address, or a document beside the entries named as a provider is, which the entries of one HTTP API share, and no other path', () => {
    const beside = { ...ledgers, document: 'documents/ledgers.openapi.json' };
    const besideWords = `${unpinned}, or documents/<name>.openapi.json, a document beside the entries named as a provider is`;

    expect([
      problemsOf(beside),
      problemsOf({ ...beside, document: 'documents/books-api.openapi.json' }),
      problemsOf({ ...beside, document: 'documents/../ledgers.openapi.json' }),
      problemsOf({ ...beside, document: 'documents/Ledgers.openapi.json' }),
      problemsOf({ ...beside, document: '{tenant}' }),
    ]).toEqual([[], [], [['/document', besideWords]], [['/document', besideWords]], [['/document', besideWords]]]);
  });
});

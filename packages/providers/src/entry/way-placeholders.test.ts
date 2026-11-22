import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { keyMadeAt, messages } from '../testing/fixture-providers.ts';
import { asTheCompanysApp, mail, signingInToMail } from '../testing/own-app-providers.ts';

const anyWords: unknown = expect.any(String);

const { tenant, mailbox } = asTheCompanysApp.placeholders;

type Fields = Readonly<Record<string, unknown>>;

function withTheApp(changes: Fields, entry: Fields = {}) {
  return problemsOf({ ...mail, ...entry, credentials: [signingInToMail, { ...asTheCompanysApp, ...changes }] });
}

function pathsOf(problems: readonly (readonly [string, string])[]): readonly string[] {
  return problems.map(([path]) => path);
}

interface Refusal {
  readonly name: string;
  readonly way: Fields;
  readonly entry: Fields;
  readonly paths: readonly string[];
}

const refusals: readonly Refusal[] = [
  {
    name: 'named as a placeholder of the provider',
    way: { placeholders: { tenant, mailbox } },
    entry: { placeholders: { tenant } },
    paths: ['/credentials/1/placeholders/tenant'],
  },
  {
    name: 'held nowhere in the way',
    way: { base_url: 'https://api.mail.example.com/v1/mailboxes/all' },
    entry: {},
    paths: ['/credentials/1/placeholders/mailbox'],
  },
  {
    name: 'held in the provider’s base_url',
    way: {},
    entry: { base_url: 'https://api.mail.example.com/v1/{mailbox}' },
    paths: ['/base_url'],
  },
  {
    name: 'named with a capital letter, which no address can hold',
    way: { placeholders: { Tenant: tenant, mailbox }, issuer: 'https://login.mail.example.com/{Tenant}' },
    entry: {},
    paths: ['/credentials/1/placeholders/Tenant', '/credentials/1/placeholders/Tenant'],
  },
  {
    name: 'written with an example that looks like a credential',
    way: { placeholders: { tenant: { ...tenant, pattern: '^.+$', example: 'sk-live-0123456789abcdefghij' }, mailbox } },
    entry: {},
    paths: ['/credentials/1/placeholders/tenant/example'],
  },
];

describe('the placeholders of a way', () => {
  it('are taken on a way that holds each in its own addresses or base_url, beside the provider’s', () => {
    const region = { description: 'The region', pattern: '^[a-z]{2}$', example: 'eu' };

    expect(problemsOf(mail)).toEqual([]);
    expect(problemsOf({ ...mail, placeholders: { region } })).toEqual([['/placeholders/region', anyWords]]);
  });

  it.each(refusals)('are refused where a placeholder of the way is $name', ({ way, entry, paths }) => {
    expect(pathsOf(withTheApp(way, entry))).toEqual(paths);
  });

  it('are refused where another way holds a placeholder of this one', () => {
    const signingInAtATenant = { ...signingInToMail, issuer: 'https://login.mail.example.com/{tenant}' };

    expect(pathsOf(problemsOf({ ...mail, credentials: [signingInAtATenant, asTheCompanysApp] }))).toEqual([
      '/credentials/0/issuer',
    ]);
  });

  it('are refused on a way of a kind another way of the provider has, since a connection is added by its kind', () => {
    const aKey = { kind: 'secret', in: 'header', name: 'X-Mail-Key', ...keyMadeAt('admin.mail.example.com') };
    const { base_url: baseUrl } = asTheCompanysApp;
    const theAppsKey = { ...aKey, permissions: 'application', placeholders: { mailbox }, base_url: baseUrl };
    const twoKeys = { ...mail, credentials: [aKey, theAppsKey] };

    expect(pathsOf(problemsOf(twoKeys))).toEqual(['/credentials/1/placeholders']);
    expect(problemsOf({ ...twoKeys, credentials: [theAppsKey] })).toEqual([]);
  });
});

const unpinned: readonly (readonly [string, string])[] = [
  ['outside https and the loopback addresses', 'http://api.mail.example.com/v1/mailboxes/{mailbox}'],
  ['holding a reference to a value of whoever runs the runtime', 'https://api.mail.example.com/${MAIL_PATH}/{mailbox}'],
];

describe('the base_url of a way', () => {
  it.each(unpinned)('is refused %s', (_case, baseUrl) => {
    expect(pathsOf(withTheApp({ base_url: baseUrl }))).toContain('/credentials/1/base_url');
  });

  it('is refused on a way of an MCP server, whose calls go to its url', () => {
    const { document: _document, base_url: _address, ...server } = mail;
    const mcp = { ...server, type: 'mcp', url: 'https://mcp.mail.example.com/mcp' };
    const elsewhere = { ...signingInToMail, base_url: 'https://mcp.mail.example.com/v2' };

    expect(problemsOf({ ...mcp, credentials: [elsewhere] })).toEqual([['/credentials/0/base_url', anyWords]]);
  });

  it('is refused on a way through a gateway, whose own entry sets where its calls go', () => {
    const [throughAGateway] = messages.credentials;
    const elsewhere = { ...throughAGateway, base_url: 'https://messages.example.com/v2' };

    expect(pathsOf(problemsOf({ ...messages, credentials: [elsewhere] }))).toEqual(['/credentials/0/base_url']);
  });
});

const tooLong = 'x'.repeat(41);

const labels: readonly (readonly [string, Fields, string])[] = [
  [
    'a placeholder’s title',
    { placeholders: { tenant: { ...tenant, title: tooLong }, mailbox } },
    'placeholders/tenant/title',
  ],
  ['a client id’s label', { client_id_title: tooLong }, 'client_id_title'],
];

describe('the labels a way and a placeholder give a person', () => {
  it('take a client id’s label on a way of client credentials alone', () => {
    const labelled = { ...signingInToMail, client_id_title: 'Application ID' };

    expect(pathsOf(problemsOf({ ...mail, credentials: [labelled, asTheCompanysApp] }))).toEqual([
      '/credentials/0/client_id_title',
    ]);
  });

  it.each(labels)('refuse %s of more than 40 characters, and take one of 40', (_case, way, path) => {
    const atMost = {
      client_id_title: 'x'.repeat(40),
      placeholders: { tenant: { ...tenant, title: 'x'.repeat(40) }, mailbox },
    };

    expect(pathsOf(withTheApp(way))).toEqual([`/credentials/1/${path}`]);
    expect(withTheApp(atMost)).toEqual([]);
  });
});

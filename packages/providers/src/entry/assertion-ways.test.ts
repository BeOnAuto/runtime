import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostPageSteps, stepsSchemaOf } from '../keys/key-fields.ts';
import { problemsOf } from '../testing/entry-problems.ts';
import {
  asAnInstalledApp,
  asAServiceAccount,
  asTheServiceAccountItself,
  installedAppRequest,
  mail,
  signingInToMail,
} from '../testing/own-app-providers.ts';
import { accountTypesOf, permissionsOf } from './account-types.ts';

type Fields = Readonly<Record<string, unknown>>;

const { subject: _subject, ...withoutASubject } = asAServiceAccount;

const { key_file: _keyFile, ...withoutAKeyFile } = asAServiceAccount;

const { inbox } = asAServiceAccount.placeholders;

const [aPage] = asAServiceAccount.steps.pages;

function pathsOf(way: Fields): readonly string[] {
  return problemsOf({ ...mail, credentials: [signingInToMail, way] }).map(([path]) => path);
}

function withTheServiceAccount(changes: Fields): readonly string[] {
  return pathsOf({ ...asAServiceAccount, ...changes });
}

function pagesOf(count: number): readonly unknown[] {
  return Array.from({ length: count }, () => aPage);
}

const refusals: readonly (readonly [string, Fields, readonly string[]])[] = [
  ['no subject but a placeholder only a subject would take', withoutASubject, ['/credentials/1/placeholders/inbox']],
  ['no key file', withoutAKeyFile, ['/credentials/1/key_file']],
  [
    'a field of another kind',
    { ...asAServiceAccount, client_id_title: 'Client ID' },
    ['/credentials/1/client_id_title'],
  ],
  [
    'a pointer into its key file that is not a JSON Pointer',
    { ...asAServiceAccount, key_file: { client_id: 'client_email', private_key: '/private_key' } },
    ['/credentials/1/key_file/client_id'],
  ],
  [
    'a subject that names a placeholder the way does not state',
    { ...asAServiceAccount, subject: '{mailbox}' },
    ['/credentials/1/subject', '/credentials/1/placeholders/inbox'],
  ],
  [
    'a subject that holds a reference to a value whoever runs Auto sets',
    { ...asAServiceAccount, subject: '{inbox}${MAIL_DOMAIN}' },
    ['/credentials/1/subject'],
  ],
  [
    'an optional placeholder in its subject, which a value left out would leave unresolved',
    { ...asAServiceAccount, placeholders: { inbox: { ...inbox, required: false } } },
    ['/credentials/1/subject'],
  ],
];

describe('a way that signs an assertion, of the kind jwt_bearer', () => {
  it('takes its issuer, its subject, where its key file holds its values, its own values and the steps of its page', () => {
    expect(withTheServiceAccount({})).toEqual([]);
  });

  it('takes no subject, for a service account that acts as itself, and then no placeholder only a subject would take', () => {
    expect(pathsOf(asTheServiceAccountItself)).toEqual([]);
    expect(pathsOf({ ...asTheServiceAccountItself, account_types: ['service'] })).toEqual([
      '/credentials/1/account_types',
    ]);
  });

  it('acts as the app, so it takes no account_types and its permissions are application', () => {
    expect([permissionsOf(asAServiceAccount), accountTypesOf(asAServiceAccount)]).toEqual(['application', []]);
    expect(withTheServiceAccount({ account_types: ['service'] })).toEqual(['/credentials/1/account_types']);
  });

  it.each(refusals)('is refused with %s', (_case, way, paths) => {
    expect(pathsOf(way)).toEqual(paths);
  });
});

describe('the steps a way asks for on other pages of its service', () => {
  it.each([
    [2, 2, true],
    [2, 3, false],
  ])('are taken, at most %i of them, as %i: %s', (most, count, taken) => {
    const decoded = Schema.decodeUnknownResult(stepsSchemaOf(most))({ pages: pagesOf(count) });

    expect(Result.isSuccess(decoded)).toBe(taken);
  });

  it('are taken four at most, as the runtime ships, each with an https page and a button label of 40 characters at most', () => {
    const { steps } = asAServiceAccount;

    expect(mostPageSteps).toBe(4);
    expect(withTheServiceAccount({ steps: { ...steps, pages: pagesOf(4) } })).toEqual([]);
    expect(withTheServiceAccount({ steps: { ...steps, pages: pagesOf(5) } })).toEqual(['/credentials/1/steps/pages']);
    expect(
      withTheServiceAccount({
        steps: { ...steps, pages: [{ ...aPage, page: 'http://admin.mail.example.com', page_title: 'x'.repeat(41) }] },
      }),
    ).toEqual(['/credentials/1/steps/pages/0/page', '/credentials/1/steps/pages/0/page_title']);
  });
});

function withTheInstalledApp(changes: Fields): readonly string[] {
  return pathsOf({ ...asAnInstalledApp, ...changes });
}

const { client_id: _appsId, ...namingNoClient } = asAnInstalledApp;

const { issuer: _appsIssuer, ...namingNoIssuer } = asAnInstalledApp;

const refusedAsAnInstalledApp: readonly (readonly [string, Fields, readonly string[]])[] = [
  ['a subject beside its token request', { subject: '{app}' }, ['/credentials/1/subject']],
  [
    'a scope beside its token request',
    { scope: 'mail.read', says: { 'mail.read': 'Read the mail.' } },
    ['/credentials/1/scope'],
  ],
  [
    'a token request outside its issuer',
    { token_request: { ...installedAppRequest, url: 'https://api.mail.example.com/users/{installation}' } },
    ['/credentials/1/token_request/url'],
  ],
  [
    'a pointer into the answer that is no JSON Pointer',
    { token_request: { ...installedAppRequest, issued: { access_token: 'token' } } },
    ['/credentials/1/token_request/issued/access_token'],
  ],
  [
    'a token request whose address holds a placeholder of no way',
    { token_request: { ...installedAppRequest, url: 'https://api.mail.example.com/apps/{tenant}/tokens' } },
    ['/credentials/1/token_request/url', '/credentials/1/placeholders/installation'],
  ],
];

const keyFilesRefused: readonly (readonly [string, Fields])[] = [
  ['pointers into the file beside its format', { format: 'pem', client_id: '/c', private_key: '/k' }],
  ['a format no key file has', { format: 'p12' }],
];

describe('a way that signs an assertion with a key file that is the private key itself in PEM', () => {
  it('takes the client the way names in its values, and the request the service has of its own for a token', () => {
    expect(withTheInstalledApp({})).toEqual([]);
    expect([permissionsOf(asAnInstalledApp), accountTypesOf(asAnInstalledApp)]).toEqual(['application', []]);
  });

  it('is refused with no client_id, since the file names none, and with no issuer, the token request then checked no further', () => {
    expect([pathsOf(namingNoClient), pathsOf(namingNoIssuer)]).toEqual([
      ['/credentials/1/client_id'],
      ['/credentials/1/issuer'],
    ]);
  });

  it.each(refusedAsAnInstalledApp)('is refused with %s', (_case, changes, paths) => {
    expect(withTheInstalledApp(changes)).toEqual(paths);
  });

  it.each(keyFilesRefused)('is refused with %s, at its key file', (_case, keyFile) => {
    const paths = withTheInstalledApp({ key_file: keyFile });

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => !path.startsWith('/credentials/1/key_file/'))).toEqual([]);
  });
});

describe('a client_id and a token request of a way', () => {
  it('are taken by a way of the kind jwt_bearer alone, and a client_id never beside a key file with pointers', () => {
    expect(withTheServiceAccount({ client_id: 'robot@acme.example.com' })).toEqual(['/credentials/1/client_id']);
    expect(pathsOf({ ...signingInToMail, client_id: 'auto' })).toEqual(['/credentials/1/client_id']);
    expect(pathsOf({ ...signingInToMail, token_request: installedAppRequest })).toEqual([
      '/credentials/1/token_request',
    ]);
  });
});

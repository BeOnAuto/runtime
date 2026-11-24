import { Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import {
  asAManagedServiceAccount,
  asAServiceAccount,
  asTheCompanysServiceAccount,
  mail,
  signingInToMail,
} from '../testing/own-app-providers.ts';
import { isTheWayAsked, permissionsOf } from './account-types.ts';

type Fields = Readonly<Record<string, unknown>>;

const ownWay = asTheCompanysServiceAccount;

const managedWay = asAManagedServiceAccount;

function pathsOf(...ways: readonly Fields[]): readonly string[] {
  return problemsOf({ ...mail, credentials: [signingInToMail, ...ways] }).map(([path]) => path);
}

function changed(changes: Fields): Fields {
  return { ...ownWay, ...changes };
}

describe('an entry that exchanges a token Auto signs for the token of a service', () => {
  it('takes a way of the company’s own service account and one of a service account Auto manages', () => {
    expect(pathsOf(ownWay, managedWay)).toEqual([]);
  });

  it.each([['token_endpoint'], ['audience'], ['subject_token']] as const)('is refused without %s', (field) => {
    expect(pathsOf(Struct.omit(ownWay, [field]))).toEqual([`/credentials/1/${field}`]);
  });

  it.each([
    ['permissions', { permissions: 'application' }, '/credentials/1/permissions'],
    ['account_types', { account_types: ['service'] }, '/credentials/1/account_types'],
    [
      'a key file',
      { key_file: { client_id: '/client_email', private_key: '/private_key' } },
      '/credentials/1/key_file',
    ],
    ['an issuer', { issuer: 'https://login.mail.example.com' }, '/credentials/1/issuer'],
    [
      'a subject token of another type',
      { subject_token: { type: 'urn:x', audience: 'a' } },
      '/credentials/1/subject_token/type',
    ],
  ] as const)('is refused with %s', (_named, changes, refused) => {
    expect(pathsOf(changed(changes))).toEqual([refused]);
  });

  it.each([
    ['managed_service_account', { managed_service_account: true }],
    ['read_only', { read_only: true }],
    ['audience', { audience: 'https://api.mail.example.com' }],
    ['impersonation', { impersonation: ownWay.impersonation }],
  ] as const)('is the only kind that takes %s', (field, changes) => {
    expect(pathsOf({ ...asAServiceAccount, ...changes })).toEqual([`/credentials/1/${field}`]);
  });
});

describe('the addresses and values of a way that exchanges a token', () => {
  it.each([
    ['a token endpoint that is not https', { token_endpoint: 'http://sts.mail.example.com/token' }, 'token_endpoint'],
    [
      'an impersonation address that is not https',
      { impersonation: { ...ownWay.impersonation, url: 'http://credentials.mail.example.com/{account}:token' } },
      'impersonation/url',
    ],
    ['an audience with a placeholder no one declares', { audience: '//identity/{pool}' }, 'audience'],
    [
      'a subject token audience with a placeholder no one declares',
      { subject_token: { ...ownWay.subject_token, audience: 'https://identity/{pool}' } },
      'subject_token/audience',
    ],
    ['an audience that refers to a variable', { audience: '//identity/${POOL}' }, 'audience'],
  ] as const)('is refused with %s', (_named, changes, refused) => {
    expect(pathsOf(changed(changes))).toEqual([`/credentials/1/${refused}`]);
  });

  it('takes a placeholder held only in its audience, its subject token or its impersonation', () => {
    const placeholders = { ...ownWay.placeholders, pool: { ...ownWay.placeholders.project, title: 'Pool' } };

    expect([
      pathsOf(changed({ placeholders, audience: '//identity/{pool}' })),
      pathsOf(changed({ placeholders, subject_token: { ...ownWay.subject_token, audience: 'https://id/{pool}' } })),
      pathsOf(changed({ placeholders })),
    ]).toEqual([[], [], ['/credentials/1/placeholders/pool']]);
  });
});

describe('the hosts of the addresses of a way that exchanges a token', () => {
  it.each([
    ['token endpoint', { token_endpoint: 'https://sts.{project}.example.com/v1/token' }, 'token_endpoint'],
    [
      'impersonation address',
      { impersonation: { ...ownWay.impersonation, url: 'https://{project}.example.com/v1/{account}:token' } },
      'impersonation/url',
    ],
  ] as const)('is refused where a value a person gives is the host of its %s', (_named, changes, refused) => {
    expect(pathsOf(changed(changes))).toEqual([`/credentials/1/${refused}`]);
  });

  it('takes a host of its token endpoint that the choices of a placeholder set', () => {
    const region = {
      description: 'Where the project is.',
      choices: [
        { value: 'eu', title: 'Europe', sets: { sts_host: 'sts-eu' } },
        { value: 'us', title: 'United States', sets: { sts_host: 'sts-us' } },
      ],
    };

    expect(
      pathsOf(
        changed({
          placeholders: { ...ownWay.placeholders, region },
          token_endpoint: 'https://{sts_host}.mail.example.com/v1/token',
          audience: '//identity.mail.example.com/projects/{project}/regions/{region}',
        }),
      ),
    ).toEqual([]);
  });
});

function impersonatingWith(parameters: Fields): Fields {
  return changed({ parameters });
}

function exchangingAloneWith(parameters: Fields): Fields {
  return Struct.omit(changed({ parameters }), ['impersonation']);
}

describe('the parameters and pointers of a way that exchanges a token', () => {
  it('takes requested_token_type among its parameters, which names a type of token and holds no credential', () => {
    expect(
      pathsOf(changed({ parameters: { requested_token_type: 'urn:ietf:params:oauth:token-type:access_token' } })),
    ).toEqual([]);
  });

  it.each([
    [{ grant_type: 'urn:x' }, impersonatingWith, ['grant_type']],
    [{ subject_token: 'a' }, impersonatingWith, ['subject_token']],
    [{ subject_token_type: 'a' }, impersonatingWith, ['subject_token_type']],
    [{ audience: 'a' }, impersonatingWith, ['audience']],
    [{ scope: 'mail.all' }, impersonatingWith, []],
    [{ scope: 'mail.all' }, exchangingAloneWith, ['scope']],
  ] as const)('refuses %o among the parameters of a way %o, at %o', (parameters, wayWith, set) => {
    expect(pathsOf(wayWith(parameters))).toEqual(set.map((name) => `/credentials/1/parameters/${name}`));
  });

  it.each([
    ['request/scope', { request: { scope: 'scope' } }],
    ['issued/access_token', { issued: { access_token: 'accessToken' } }],
    ['issued/expires_at', { issued: { access_token: '/accessToken', expires_at: 'expireTime' } }],
  ] as const)('is refused where the impersonation’s %s is no JSON Pointer', (refused, changes) => {
    expect(pathsOf(changed({ impersonation: { ...ownWay.impersonation, ...changes } }))).toEqual([
      `/credentials/1/impersonation/${refused}`,
    ]);
  });
});

describe('the steps of a way that exchanges a token', () => {
  it.each([
    ['{issuer} and {subject}', 'Add the issuer {issuer} and the subject {subject}.', []],
    ['a placeholder of the way', 'Let it act as {account} in {project}.', []],
    ['another name', 'Open {console}.', ['/credentials/1/steps/pages/0/instructions']],
  ] as const)('may name %s', (_named, instructions, refused) => {
    const page = { title: 'Allow it', instructions, page: 'https://admin.mail.example.com/x', page_title: 'Open Mail' };

    expect(pathsOf(changed({ steps: { pages: [page] } }))).toEqual(refused);
  });

  it('are each judged, the step of the key page, of the key and once connected', () => {
    const named = { title: 'Do it', instructions: 'Open {console}.' };

    expect(pathsOf(changed({ steps: { key_page: named, key: named, connected: named } }))).toEqual([
      '/credentials/1/steps/key_page/instructions',
      '/credentials/1/steps/key/instructions',
      '/credentials/1/steps/connected/instructions',
    ]);
  });

  it('are not judged for placeholders on a way of another kind', () => {
    const steps = { key: { title: 'Enter the details here', instructions: 'Choose the file for {console}.' } };

    expect(pathsOf({ ...asAServiceAccount, steps })).toEqual([]);
  });
});

describe('the test of a way that exchanges a token', () => {
  it.each([
    ['without reached', { tool: 'mailboxes_list' }, '/credentials/1/test'],
    [
      'with a list that is no JSON Pointer',
      { tool: 'mailboxes_list', reached: { list: 'mailboxes', name: '/address' } },
      '/credentials/1/test/reached/list',
    ],
    [
      'with a name that is no JSON Pointer',
      { tool: 'mailboxes_list', reached: { list: '/mailboxes', name: 'address' } },
      '/credentials/1/test/reached/name',
    ],
  ] as const)('is refused %s', (_named, test, refused) => {
    expect(pathsOf(changed({ test }))).toEqual([refused]);
  });

  it('takes an empty pointer to the name, where each item of the list is the name itself', () => {
    const test = { tool: 'mailboxes_list', reached: { list: '/resourceNames', name: '' } };

    expect(pathsOf(changed({ test }))).toEqual([]);
  });

  it('takes the arguments its tool is called with', () => {
    const test = { ...ownWay.test, with: { folder: 'inbox', limit: 50 } };

    expect(pathsOf(changed({ test }))).toEqual([]);
  });

  it('is refused where the entry marks its tool acts', () => {
    const marked = { ...mail, marks: { acts: ['mailboxes_list'] }, credentials: [ownWay] };

    expect(problemsOf(marked).map(([path]) => path)).toEqual(['/credentials/0/test/tool']);
  });
});

const twiceRefused = ['/credentials/1/placeholders', '/credentials/2/kind', '/credentials/2/placeholders'] as const;

describe('the ways of the kind token_exchange in one entry', () => {
  it.each([
    ['twice without managed_service_account', [ownWay, ownWay], twiceRefused],
    ['twice with managed_service_account', [managedWay, managedWay], twiceRefused],
    ['once of each, each asking values of its own', [ownWay, managedWay], []],
  ] as const)('are refused at %o where the entry has the way %s', (_named, ways, refused) => {
    expect(pathsOf(...ways).toSorted()).toEqual(refused.toSorted());
  });

  it.each([
    [ownWay, { kind: 'token_exchange' }, true],
    [ownWay, { kind: 'token_exchange', service_account: 'managed' }, false],
    [managedWay, { kind: 'token_exchange', service_account: 'managed' }, true],
    [managedWay, { kind: 'token_exchange' }, false],
    [managedWay, managedWay, true],
    [ownWay, { kind: 'token_exchange', permissions: 'application' }, true],
  ] as const)('finds %o as the way of %o: %s', (way, asked, found) => {
    expect(isTheWayAsked(way, asked)).toBe(found);
  });

  it('acts as the app, so it takes the permissions of an application', () => {
    expect(permissionsOf(managedWay)).toBe('application');
  });
});

import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { asAnInstallingApp, asAServiceAccount, mail, signingInToMail } from '../testing/own-app-providers.ts';

type Fields = Readonly<Record<string, unknown>>;

function pathsOf(way: Fields): readonly string[] {
  return problemsOf({ ...mail, credentials: [signingInToMail, way] }).map(([path]) => path);
}

const { installation: installing } = asAnInstallingApp;

function withTheInstallation(changes: Fields): Fields {
  return { ...asAnInstallingApp, installation: { ...installing, ...changes } };
}

const installingRefusals: readonly (readonly [string, Fields, string])[] = [
  [
    'on a way that acts as an account',
    { ...asAnInstallingApp, permissions: 'delegated' },
    '/credentials/1/installation',
  ],
  ['beside a scope', { ...asAnInstallingApp, scope: 'mail.all' }, '/credentials/1/scope'],
  ['beside parameters', { ...asAnInstallingApp, parameters: { prompt: 'consent' } }, '/credentials/1/parameters'],
  [
    'beside another client source',
    { ...asAnInstallingApp, clients: ['registered', 'dynamic'] },
    '/credentials/1/clients',
  ],
  [
    'with an issuer that holds a placeholder',
    withTheInstallation({ issuer: 'https://api.mail.example.com/{tenant}' }),
    '/credentials/1/installation/issuer',
  ],
  ['with an issuer that is no address', withTheInstallation({ issuer: 'mail' }), '/credentials/1/installation/issuer'],
  [
    'listing the installations outside its issuer',
    withTheInstallation({ installations: { ...installing.installations, url: 'https://elsewhere.example.com/i' } }),
    '/credentials/1/installation/installations/url',
  ],
  [
    'with a pointer into the listing that is no JSON Pointer',
    withTheInstallation({ installations: { ...installing.installations, id: 'id' } }),
    '/credentials/1/installation/installations/id',
  ],
  [
    'asking who the person is outside its issuer',
    withTheInstallation({ userinfo: { ...installing.userinfo, url: 'https://elsewhere.example.com/me' } }),
    '/credentials/1/installation/userinfo/url',
  ],
  [
    'asking who the person is with a placeholder',
    withTheInstallation({ userinfo: { ...installing.userinfo, url: 'https://api.mail.example.com/apps/{tenant}' } }),
    '/credentials/1/installation/userinfo/url',
  ],
  [
    'asking a membership without the account’s name',
    withTheInstallation({ membership: { ...installing.membership, url: 'https://api.mail.example.com/apps/me' } }),
    '/credentials/1/installation/membership/url',
  ],
  [
    'asking a membership with another placeholder beside the account’s name',
    withTheInstallation({
      membership: { ...installing.membership, url: 'https://api.mail.example.com/apps/{tenant}/{account_name}' },
    }),
    '/credentials/1/installation/membership/url',
  ],
  [
    'asking a membership outside its issuer',
    withTheInstallation({
      membership: { ...installing.membership, url: 'https://elsewhere.example.com/{account_name}' },
    }),
    '/credentials/1/installation/membership/url',
  ],
  [
    'with no condition that says the person is an admin',
    withTheInstallation({ membership: { ...installing.membership, admin: {} } }),
    '/credentials/1/installation/membership/admin',
  ],
  [
    'with a condition on the membership that is no JSON Pointer',
    withTheInstallation({ membership: { ...installing.membership, admin: { role: ['owner'] } } }),
    '/credentials/1/installation/membership/admin',
  ],
  [
    'with no condition that says an installation is on a personal account',
    withTheInstallation({ installations: { ...installing.installations, personal: {} } }),
    '/credentials/1/installation/installations/personal',
  ],
  [
    'asking its token with another placeholder than the installation',
    withTheInstallation({
      token_request: { ...installing.token_request, url: 'https://api.mail.example.com/apps/{tenant}/tokens' },
    }),
    '/credentials/1/installation/token_request/url',
  ],
  [
    'asking its token outside its issuer',
    withTheInstallation({
      token_request: { ...installing.token_request, url: 'https://elsewhere.example.com/{installation_id}/tokens' },
    }),
    '/credentials/1/installation/token_request/url',
  ],
];

describe('a way that connects by installing the application whoever runs Auto registered', () => {
  it('takes its installation beside application permissions and the registered client alone, or no clients', () => {
    const { clients: _clients, ...withoutClients } = asAnInstallingApp;

    expect([pathsOf(asAnInstallingApp), pathsOf(withoutClients)]).toEqual([[], []]);
  });

  it.each(installingRefusals)('is refused %s', (_case, way, path) => {
    expect(pathsOf(way)).toContain(path);
  });

  it.each(['userinfo', 'membership'] as const)(
    'is refused at start without the %s request that says who administers an installation’s account',
    (field) => {
      const { [field]: _left, ...without } = installing;

      expect(pathsOf({ ...asAnInstallingApp, installation: without })).toContain(
        `/credentials/1/installation/${field}`,
      );
    },
  );

  it.each(['account', 'personal'] as const)(
    'is refused at start without the %s of each installation it lists',
    (field) => {
      const { [field]: _left, ...without } = installing.installations;

      expect(pathsOf(withTheInstallation({ installations: without }))).toContain(
        `/credentials/1/installation/installations/${field}`,
      );
    },
  );

  it('is refused on a kind that installs nothing', () => {
    expect(pathsOf({ ...asAServiceAccount, installation: installing })).toContain('/credentials/1/installation');
  });
});

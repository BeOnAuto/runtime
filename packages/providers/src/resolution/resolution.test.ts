import { pinnedUrlShape } from '@on.auto/tool-servers';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider, type GivenToProvider, type ProviderEntry } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { campaigns, drive, messages, tracker } from '../testing/fixture-providers.ts';
import { agents } from '../testing/own-app-providers.ts';

const anyWords: unknown = expect.any(String);

function resolved(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(additionOfProvider(provider, given));
}

function refused(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(Result.flip(additionOfProvider(provider, given)));
}

const [consent] = drive.credentials;

const sharing = {
  name: 'share',
  for: 'Share your files with other people.',
  scope: 'files.share',
  says: { 'files.share': 'Share the files of the account with other people.' },
};

const growing = decodedEntry({
  ...drive,
  credentials: [{ ...consent, more: [sharing] }, { kind: 'none' }],
});

const [aKey] = tracker.credentials;

const keyed = decodedEntry({
  ...tracker,
  credentials: [
    { ...aKey, account_types: ['personal'] },
    { ...aKey, permissions: 'application' },
  ],
});

describe('the way an addition takes of a provider with two ways of one kind', () => {
  it('takes the first way of the kind, and carries what it acts as and the account types it takes', () => {
    const addition = resolved(keyed, { kind: 'secret', placeholders: { site: 'acme' } });

    expect([addition.permissions, addition.account_types]).toEqual(['delegated', ['personal']]);
  });

  it('carries the permissions of a way that acts as the app, which takes no account type', () => {
    const addition = resolved(decodedEntry({ ...tracker, credentials: [{ ...aKey, permissions: 'application' }] }), {
      placeholders: { site: 'acme' },
    });

    expect([addition.permissions, addition.account_types]).toEqual(['application', []]);
  });
});

describe('the way an addition takes of a provider with one way of each kind', () => {
  it('takes the way of the kind the caller names, the first where it names none, and refuses a kind the provider does not take', () => {
    expect([resolved(growing, {}).credential.kind, resolved(growing, { kind: 'none' }).credential.kind]).toEqual([
      'authorization',
      'none',
    ]);
    expect(refused(growing, { kind: 'secret' })).toEqual([
      {
        pointer: '/credential/kind',
        detail: 'The provider drive takes no secret credential; it takes authorization or none',
      },
    ]);
  });

  it('carries the scope, the parameters and the words of what the first consent asks, and nothing of what a later one may add', () => {
    const addition = resolved(growing, { kind: 'authorization' });

    expect(addition.credential).toEqual({
      kind: 'authorization',
      issuer: 'https://accounts.drive.example.com',
      scope: 'files.read files.write',
      parameters: { access_type: 'offline', prompt: 'consent' },
    });
    expect(addition.says).toEqual(consent?.says);
  });
});

describe('the way an addition takes of a provider whose written-out server takes no PKCE', () => {
  it('carries its pkce beside its endpoints', () => {
    const [writtenOut] = campaigns.credentials;
    const unchallenged = decodedEntry({ ...campaigns, credentials: [{ ...writtenOut, pkce: 'none' }] });

    expect(resolved(unchallenged, { placeholders: { region: 'na' } }).credential).toMatchObject({
      authorization_endpoint: 'https://auth.campaigns.example.com/authorize',
      pkce: 'none',
    });
  });
});

const keyPage = 'https://app.tracker.example.com/settings/keys';

const [byKey] = tracker.credentials;

describe('the credential of an addition by a key', () => {
  it('carries how its key is made and what it looks like from the way, and not the description of the way', () => {
    const formatted = decodedEntry({
      ...tracker,
      credentials: [{ ...byKey, example: 'trk_…', pattern: '^trk_\\w+$' }],
    });

    expect(Result.getOrThrow(additionOfProvider(formatted, { placeholders: { site: 'acme' } })).credential).toEqual({
      kind: 'secret',
      in: 'header',
      name: 'Authorization',
      scheme: 'Bearer',
      instructions: `Make a key at [app.tracker.example.com](${keyPage}) under **Settings**, **Keys**, with read access.`,
      key_page: keyPage,
      example: 'trk_…',
      pattern: '^trk_\\w+$',
    });
  });
});

describe('the addition of a way of consent through a gateway', () => {
  it('records the gateway as the source of its client from the addition, with the security scheme its key is sent under', () => {
    const { credential, says } = Result.getOrThrow(additionOfProvider(messages, {}));

    expect(credential).toEqual({
      kind: 'authorization',
      client_source: 'gateway',
      in: 'security',
      name: 'connection_key',
      issuer: 'https://messages.example.com',
      scope: 'messages:read messages:write',
    });
    expect(says).toEqual({
      'messages:read': 'Read the messages of the workspace.',
      'messages:write': 'Post messages in the workspace.',
    });
  });

  it('refuses the organization’s own OAuth client, since the gateway makes the consent with a client of its own', () => {
    expect(Result.merge(Result.flip(additionOfProvider(messages, { oauthClientFor: () => 'own' })))).toEqual([
      {
        pointer: '/credential/oauth_client',
        detail: anyWords,
      },
    ]);
  });
});

describe('the addition of a way of consent under the organization’s own OAuth client', () => {
  const requiring = decodedEntry({ ...drive, credentials: [{ ...drive.credentials[0], oauth_client: 'required' }] });

  it('keeps own as the source of its client, where the caller asks for the organization’s own OAuth client or the way requires it, and nothing else of the way', () => {
    expect([
      resolved(drive, { oauthClientFor: () => 'own' }).credential,
      resolved(requiring, {}).credential,
      resolved(drive, {}).credential.client_source,
    ]).toEqual([
      {
        kind: 'authorization',
        client_source: 'own',
        issuer: 'https://accounts.drive.example.com',
        scope: 'files.read files.write',
        parameters: { access_type: 'offline', prompt: 'consent' },
      },
      {
        kind: 'authorization',
        client_source: 'own',
        issuer: 'https://accounts.drive.example.com',
        scope: 'files.read files.write',
        parameters: { access_type: 'offline', prompt: 'consent' },
      },
      undefined,
    ]);
  });

  it('is no source of a client for a way that is not consent, which takes no OAuth client', () => {
    expect(
      resolved(tracker, { oauthClientFor: () => 'own', kind: 'secret', placeholders: { site: 'acme' } }).credential,
    ).toMatchObject({ kind: 'secret', in: 'header', name: 'Authorization', scheme: 'Bearer' });
    expect(
      resolved(tracker, { oauthClientFor: () => 'own', kind: 'secret', placeholders: { site: 'acme' } }).credential,
    ).not.toHaveProperty('client_source');
  });
});

describe('the addition a provider of consent makes with a choice', () => {
  it('places the host the choice sets in the token endpoint, as it does in the address of the API', () => {
    const { entry, credential } = resolved(campaigns, { placeholders: { region: 'eu' } });

    expect([entry.base_url, credential]).toEqual([
      'https://api-eu.campaigns.example.com/v1',
      {
        kind: 'authorization',
        issuer: 'https://auth.campaigns.example.com',
        authorization_endpoint: 'https://auth.campaigns.example.com/authorize',
        token_endpoint: 'https://auth-eu.campaigns.example.com/oauth/token',
        revocation_endpoint: 'https://auth.campaigns.example.com/revoke',
        scope: 'campaigns.read',
      },
    ]);
  });
});

const heldCredential =
  'Looks like a credential, which a placeholder never holds: the person gives the credential on the page the link opens';

describe('the value of a placeholder of format uri', () => {
  it.each([
    'https://agents.acme.example.com/mcp',
    'https://agents.acme.example.com:8443/v1/mcp?region=eu',
    'http://127.0.0.1:8931/mcp',
  ])('is the address of the connection exactly as it is given: %s', (address) => {
    expect(resolved(agents, { placeholders: { address } }).entry.url).toBe(address);
  });

  it.each([
    ['an http URL on a host that is not a loopback address', 'http://agents.acme.example.com/mcp', pinnedUrlShape],
    ['no URL', 'agents.acme.example.com/mcp', pinnedUrlShape],
    ['another scheme', 'wss://agents.acme.example.com/mcp', pinnedUrlShape],
    ['a password in it', 'https://ada:sk-live-0123456789abcdefghij@agents.acme.example.com/mcp', heldCredential],
    ['a key in its query', 'https://agents.acme.example.com/mcp?api_key=sk-live-0123456789abcdefghij', heldCredential],
    [
      'a $, with which a reference begins',
      '${AGENTS_ADDRESS}',
      'Holds a $, which a placeholder never holds, since a reference to an environment variable begins with it',
    ],
  ])('is refused where an address given by hand would be, as for %s', (_, address, detail) => {
    expect(refused(agents, { placeholders: { address } })).toEqual([{ pointer: '/placeholders/address', detail }]);
  });

  it('is asked of the person, since a provider whose address is given whole has no address without it', () => {
    expect(refused(agents, {})).toEqual([{ pointer: '/placeholders/address', detail: anyWords }]);
  });
});

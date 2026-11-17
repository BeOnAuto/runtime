import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider, type GivenToProvider, type ProviderEntry } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { campaigns, drive, messages, tracker } from '../testing/fixture-providers.ts';

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

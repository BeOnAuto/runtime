import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider, type GivenToProvider, type ProviderEntry } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { drive, tracker } from '../testing/fixture-providers.ts';

function resolved(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(additionOfProvider(provider, given));
}

describe('the addition of a way of consent under the org’s own app', () => {
  const requiring = decodedEntry({ ...drive, credentials: [{ ...drive.credentials[0], own_app: 'required' }] });

  it('keeps own as the source of its client, where the caller asks for the org’s app or the way requires it, and nothing else of the way', () => {
    expect([
      resolved(drive, { appFor: () => 'own' }).credential,
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

  it('is no source of a client for a way that is not consent, which takes no app', () => {
    expect(
      resolved(tracker, { appFor: () => 'own', kind: 'secret', placeholders: { site: 'acme' } }).credential,
    ).toEqual({
      kind: 'secret',
      in: 'header',
      name: 'Authorization',
      scheme: 'Bearer',
    });
  });
});

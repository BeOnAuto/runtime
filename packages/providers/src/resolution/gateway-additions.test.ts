import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider } from '../index.ts';
import { messages } from '../testing/fixture-providers.ts';

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
        detail:
          'Expected no oauth_client: the provider messages connects through a gateway, which makes the consent with a client of its own',
      },
    ]);
  });
});

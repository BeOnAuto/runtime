import { allPermissions, type CallingClient } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { fakeIssuer, principalIn, signedTokens, type Claims } from '../testing/index.ts';

const atStart = { now: () => Date.parse('2026-10-13T09:00:00Z') };

const agentsDocument = 'https://agent.example/oauth/client.json';

const clientsNamed: ReadonlyArray<readonly [string, Claims, CallingClient]> = [
  [
    'a client named by its metadata document, by its client_id, its client_name and the host of that document',
    { client_id: agentsDocument, client_name: 'An agent' },
    { id: agentsDocument, name: 'An agent', domain: 'agent.example' },
  ],
  [
    'a client registered with the issuer, by its client_id alone, with no domain',
    { client_id: 'f7d3b2a1' },
    { id: 'f7d3b2a1', name: null, domain: null },
  ],
  [
    'a client whose client_id is an address that is not https, with no domain',
    { client_id: 'http://agent.example/client.json', client_name: 'An agent' },
    { id: 'http://agent.example/client.json', name: 'An agent', domain: null },
  ],
  [
    'a client whose client_name is no name the facts take, with no name',
    { client_id: agentsDocument, client_name: 'An\u0000agent' },
    { id: agentsDocument, name: null, domain: 'agent.example' },
  ],
];

const namingNoClient: ReadonlyArray<readonly [string, Claims]> = [
  ['a token that holds no client_id', {}],
  ['a client_id that is no name the facts take', { client_id: 'x'.repeat(257), client_name: 'An agent' }],
  ['a client_id that is not a string', { client_id: 7 }],
];

describe('the client an access token was issued to', () => {
  it.each(clientsNamed)('is the client of the caller, for %s', async (_case, claims, client) => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = principalIn(await identityService.personOf(await token(claims), '/mcp'));

    expect([person?.own.client, person?.callerIn('acme')?.client]).toEqual([client, client]);
  });

  it.each(namingNoClient)('is none, the token taken all the same, for %s', async (_case, claims) => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = principalIn(await identityService.personOf(await token(claims), '/mcp'));

    expect(person?.own).toEqual({
      id: 'person:ada',
      name: 'Ada Lovelace',
      org: 'acme',
      permissions: allPermissions,
      playbooks: '*',
    });
    expect(person?.own).not.toHaveProperty('client');
  });
});

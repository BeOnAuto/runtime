import { Caller, type CallerIdentity } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ada } from '../testing/harness.ts';
import { issuedLink, tokenSha256Of, type IssuedLink } from './link-token.ts';

function issuedTo(caller: CallerIdentity): Promise<IssuedLink> {
  return Effect.runPromise(issuedLink.pipe(Effect.provideService(Caller, caller)));
}

const client = { id: 'https://agent.example/oauth/client.json', name: 'An agent', domain: 'agent.example' };

describe('a link to connect a connection', () => {
  it('holds its token and the digest the fact keeps of it, and no end', async () => {
    const link = await issuedTo(ada);

    expect(Object.keys(link).toSorted()).toEqual(['token', 'token_sha256']);
    expect(link.token_sha256).toBe(tokenSha256Of(link.token));
  });

  it('holds the client the caller called through, where the caller names one, and no end', async () => {
    const link = await issuedTo({ ...ada, client });

    expect(Object.keys(link).toSorted()).toEqual(['asked_by', 'token', 'token_sha256']);
    expect(link.asked_by).toEqual(client);
  });
});

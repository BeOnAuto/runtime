import { playbookCallerOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { authenticatorFor, createApiKey, isKeyHolder, isSignedInPerson } from '../index.ts';
import { fakeIssuer, principalIn, signedTokens } from '../testing/index.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: ['org:write'], playbooks: '*' });

describe('a signed-in person', () => {
  it('is the caller of a token of the identity service, and neither a key nor the local developer', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'));
    const signingIn = authenticatorFor({ host: '0.0.0.0', apiKeys: [admin.entry], identityService });
    const local = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });

    const ids = [
      principalIn(await signingIn.authenticate(await token(), '/mcp'))?.own.id,
      principalIn(await signingIn.authenticate(admin.key, '/mcp'))?.own.id,
      principalIn(await local.authenticate(undefined, '/mcp'))?.own.id,
    ];

    expect(ids).toEqual(['person:ada', 'acme-admin', 'local']);
    expect(ids.map((id = '') => isSignedInPerson({ id }))).toEqual([true, false, false]);
  });
});

describe('a key holder', () => {
  it('is the caller of a key, and neither a signed-in person, the local developer nor a playbook acting as itself', () => {
    const ids = ['acme-admin', 'person:ada', 'local', playbookCallerOf({ org: 'acme', playbook: 'alpha' }).id];

    expect(ids.map((id) => isKeyHolder({ id }))).toEqual([true, false, false, false]);
  });
});

import { allPermissions, type CallerIdentity } from '@on.auto/operations';
import { Context } from 'effect';
import { describe, expect, it } from 'vitest';

import { authInfoFor, playbookCallOf, orgCallOf } from './caller-hand-off.ts';

const caller: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: ['alpha'] };

class Invocation extends Context.Service<Invocation, { readonly id: string }>()('test/Invocation') {}

const orgCall = {
  caller,
  org: 'acme',
  requestId: 'request-1',
  dropped: [{ id: 7, value: { admin: true } }],
  context: Context.empty(),
};

describe('the hand-off of a caller to the MCP SDK', () => {
  it('carries the caller id and permissions, and a placeholder instead of any credential', () => {
    expect(authInfoFor(orgCall)).toEqual({
      token: 'verified-by-auto-runtime',
      clientId: 'acme-admin',
      scopes: [...allPermissions],
      extra: orgCall,
    });
  });

  it('reads back the call of an org endpoint and of a playbook endpoint, with the arguments the SDK drops and the context of the call', () => {
    const playbookCall = { ...orgCall, playbook: 'alpha' };

    expect({
      org: orgCallOf({ authInfo: authInfoFor(orgCall) }),
      playbook: playbookCallOf({ authInfo: authInfoFor(playbookCall) }),
    }).toEqual({ org: orgCall, playbook: playbookCall });
  });

  it('hands over the context of the call as the very object the shell made, so a service bound to the request reaches the call as it was bound', () => {
    const context = Context.make(Invocation, { id: 'invocation-1' });
    const call = { ...orgCall, context };

    expect(orgCallOf({ authInfo: authInfoFor(call) }).context).toBe(context);
    expect(playbookCallOf({ authInfo: authInfoFor({ ...call, playbook: 'alpha' }) }).context).toBe(context);
  });

  it('refuses to serve a request without authentication information', () => {
    expect(() => orgCallOf({})).toThrow('Expected object');
  });

  it('refuses to serve a request whose authentication information carries no caller', () => {
    expect(() => orgCallOf({ authInfo: { extra: { org: 'acme', requestId: 'request-1', dropped: [] } } })).toThrow(
      'caller',
    );
  });

  it('refuses to serve a playbook endpoint without a playbook', () => {
    expect(() => playbookCallOf({ authInfo: authInfoFor(orgCall) })).toThrow('playbook');
  });
});

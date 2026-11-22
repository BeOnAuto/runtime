import type { Principal } from '@on.auto/identity';
import { allPermissions, type CallerIdentity } from '@on.auto/operations';
import { Context } from 'effect';
import { describe, expect, it } from 'vitest';

import { actingAsIn, authInfoFor, orgCallOf, playbookCallOf } from './caller-hand-off.ts';
import { droppedArgumentsIn, postedMessagesOf, withDroppedArgument } from './dropped-arguments.ts';

function posted(body: string, headers: Readonly<Record<string, string>> = {}): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

const callWithProto =
  '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"x","arguments":{"__proto__":{"admin":true}}}}';

async function droppedArgumentsOf(request: Request): Promise<readonly unknown[]> {
  return droppedArgumentsIn(await postedMessagesOf(request));
}

describe('the arguments dropped from the messages posted to an MCP endpoint', () => {
  it('finds a __proto__ argument of a tool call by its request id, and leaves the body for the SDK', async () => {
    const request = posted(callWithProto);

    expect(await droppedArgumentsOf(request)).toEqual([{ id: 7, value: { admin: true } }]);
    expect(await request.text()).toBe(callWithProto);
  });

  it('finds them in a batch, and only in tool calls that have one', async () => {
    const batch = `[${callWithProto},{"jsonrpc":"2.0","id":"b","method":"tools/call","params":{"name":"x","arguments":{"name":"n"}}},{"jsonrpc":"2.0","id":9,"method":"tools/list","params":{"__proto__":1}}]`;

    expect(await droppedArgumentsOf(posted(batch))).toEqual([{ id: 7, value: { admin: true } }]);
  });

  it.each([
    ['a body that is not JSON', posted('{"jsonrpc"')],
    ['a body over the limit', posted(callWithProto, { 'content-length': String(2 * 1024 * 1024) })],
    ['no body', new Request('http://localhost/mcp', { method: 'POST' })],
  ])('finds nothing in %s, and leaves the answer to the SDK', async (_case, request) => {
    expect(await droppedArgumentsOf(request)).toEqual([]);
  });
});

describe('withDroppedArgument', () => {
  it('gives the arguments back their __proto__ as an own field, leaving the prototype alone', () => {
    const restored = withDroppedArgument({ name: 'n' }, { id: 7, value: { admin: true } });

    expect(Object.hasOwn(restored, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
    expect(Object.entries(restored)).toEqual([
      ['name', 'n'],
      ['__proto__', { admin: true }],
    ]);
  });

  it('leaves the arguments as they are when nothing was dropped', () => {
    const input = { name: 'n' };

    expect(withDroppedArgument(input)).toBe(input);
  });
});

const caller: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: ['alpha'],
};

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

function principalOf(own: CallerIdentity, named: Pick<Principal, 'orgName'>): Principal {
  return { own, callerIn: (org) => ({ ...own, org }), ...named };
}

describe('the hand-off of the org a caller acts in', () => {
  const orgName = 'Initech';

  it('names the org by the name the caller’s credential gives it, for the org the credential names alone', () => {
    const named = principalOf(caller, { orgName });
    const unnamed = principalOf(caller, {});

    expect([
      actingAsIn(named, caller, 'acme'),
      actingAsIn(named, caller, 'globex'),
      actingAsIn(unnamed, caller, 'acme'),
    ]).toEqual([
      { caller, org: 'acme', orgName },
      { caller, org: 'globex' },
      { caller, org: 'acme' },
    ]);
  });

  it('reads back the name of the org beside its id', () => {
    const named = { ...orgCall, orgName };

    expect(orgCallOf({ authInfo: authInfoFor(named) })).toEqual(named);
  });
});

describe('the hand-off of a signed-in person who called through a client', () => {
  it('reads back the client a signed-in person called through, so an operation the call reaches records it', () => {
    const throughAClient = {
      ...orgCall,
      caller: {
        ...caller,
        id: 'person:ada',
        name: 'Ada Lovelace',
        client: { id: 'https://agent.example/oauth/client.json', name: 'An agent', domain: 'agent.example' },
      },
    };

    expect(orgCallOf({ authInfo: authInfoFor(throughAClient) }).caller).toEqual(throughAClient.caller);
  });
});

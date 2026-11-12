import type { ConnectionUnready } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added } from '../testing/additions.ts';
import { askingThrough, toolsThrough } from '../testing/described-apis.ts';
import { connectedThrough, gatewayHarnessAt, gatewayServed, providersThrough } from '../testing/gateways.ts';
import { ada, harness, operationNamed } from '../testing/harness.ts';
import { servedAs, sourceOver } from '../testing/served-connections.ts';

const askingWho = { server: 'messages', tool: 'who_am_i', arguments: {} };

const onTheLoopback = connectionPolicyOf({ allowed_hosts: ['127.0.0.1'] });

async function refusalOf(source: ReturnType<typeof sourceOver>, id: string): Promise<ConnectionUnready> {
  const { state } = await servedAs(source, id);
  return state.status === 'connected' ? Effect.runPromise(Effect.flip(state.server)) : state.unready;
}

describe('a call of a connection made through its gateway', () => {
  it('carries the connection’s key under the security scheme the document names, and no other credential', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    await connectedThrough(h, gateway);
    const [key = ''] = gateway.keys();
    const tools = await toolsThrough(h, askingThrough(), { providers: providersThrough(gateway) });

    const called = await tools.call('execute_connection', askingWho);

    expect(called).toMatchObject({ status: 'succeeded' });
    const call = gateway.seen().find(({ path }) => path === '/api/whoami');
    expect(call?.headers[gateway.keyHeader.toLowerCase()]).toBe(key);
    expect(call?.headers).not.toHaveProperty('authorization');
  });

  it('carries the key in whatever header the document’s scheme names, which the runtime itself never names', async () => {
    const gateway = await gatewayServed({ keyHeader: 'X-Relay-Key' });
    const h = gatewayHarnessAt(gateway);
    await connectedThrough(h, gateway);
    const tools = await toolsThrough(h, askingThrough(), { providers: providersThrough(gateway) });

    const called = await tools.call('execute_connection', askingWho);

    expect(called).toMatchObject({ status: 'succeeded' });
    expect(gateway.seen().find(({ path }) => path === '/api/whoami')?.headers).toMatchObject({
      'x-relay-key': gateway.keys()[0],
    });
  });
});

describe('a connection made through its gateway whose key the gateway no longer takes', () => {
  it('is broken as one whose access ended', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    gateway.answering('call', 401, { error: 'invalid_token' });
    const tools = await toolsThrough(h, askingThrough(), { providers: providersThrough(gateway) });

    await tools.call('execute_connection', askingWho);
    const got = await h.call(operationNamed(h.operations, 'get_connection'), ada, { id: link.id });

    expect(got).toMatchObject({
      output: {
        status: 'broken',
        broken: {
          kind: 'consent_ended',
          detail:
            'The consent of the connection messages was revoked or has ended, so the person who added it reconnects it',
        },
      },
    });
  });
});

describe('a connection given by hand at the address of a gateway', () => {
  it('is refused when it is used, naming the provider that connects through it', async () => {
    const gateway = await gatewayServed();
    const h = harness({ policy: onTheLoopback });
    const { id, token } = await added(h, {
      name: 'relay',
      type: 'mcp',
      entry: { url: `${gateway.origin}/mcp` },
      credential: { kind: 'none' },
    });
    await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });

    const refusal = await refusalOf(sourceOver(h, { policy: onTheLoopback, providers: providersThrough(gateway) }), id);

    expect(refusal).toEqual({
      because: 'connection_not_allowed',
      detail: `A connection given by hand may not reach ${gateway.origin}, which the provider messages connects through; add the provider messages instead`,
    });
  });
});

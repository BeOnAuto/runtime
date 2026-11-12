import { testAccount } from '@on.auto/tool-servers/served-fakes';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added } from '../testing/additions.ts';
import { starting, startedAt } from '../testing/consents.ts';
import { connectedThrough, gatewayHarnessAt, gatewayServed } from '../testing/gateways.ts';
import { acmeWriter, ada, operationNamed } from '../testing/harness.ts';

const grantedByTheGateway = 'messages:read messages:write';

const aState: unknown = expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u);

describe('the start of a connection made through its gateway', () => {
  it('goes to the gateway with the runtime’s own state, which the page reads back from the address it sends the person to', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const link = await added(h, { provider: 'messages' });

    const started = await starting(h, link);
    const address = new URL((await startedAt(h, link)).url);

    expect(started).toMatchObject({ status: 'succeeded', output: { client_source: 'gateway' } });
    expect([address.origin, address.searchParams.get('state')]).toEqual([gateway.origin, aState]);
    expect((await h.facts()).at(-1)).toMatchObject({
      type: 'connection_consent_started',
      data: { client_source: 'gateway', client_id: 'gateway-client-1' },
    });
  });

  it('is answered on the connection’s link as one whose client the gateway is', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { id, token } = await added(h, { provider: 'messages' });

    expect(await h.call(operationNamed(h.operations, 'read_link'), acmeWriter, { id, token })).toMatchObject({
      output: { client_source: 'gateway' },
    });
  });
});

describe('the finish of a connection made through its gateway', () => {
  it('connects it with the key it is handed, recording the account the gateway names and the scope it granted', async () => {
    const gateway = await gatewayServed({ scope: grantedByTheGateway });
    const h = gatewayHarnessAt(gateway);

    const { outcome } = await connectedThrough(h, gateway);

    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'connected',
        account: testAccount,
        granted_scope: grantedByTheGateway,
        credential: { kind: 'authorization', client_source: 'gateway', client_id: 'gateway-client-1' },
      },
    });
    expect((await h.facts()).at(-1)).toMatchObject({
      type: 'connection_connected',
      data: { client_source: 'gateway', account: testAccount, scope: grantedByTheGateway },
    });
    expect([...h.secrets.values().values()]).toEqual(gateway.keys());
  });

  it('keeps the key sealed, out of every answer, fact and log line', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link, outcome } = await connectedThrough(h, gateway);
    const [key = ''] = gateway.keys();

    const listed = await h.call(operationNamed(h.operations, 'list_connections'), ada);
    const got = await h.call(operationNamed(h.operations, 'get_connection'), ada, { id: link.id });

    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify([outcome, listed, got, await h.facts(), h.logged()])).not.toContain(key);
  });
});

describe('the account on the connections a list answers', () => {
  it('is the one the gateway named, and none for a connection no gateway named', async () => {
    const gateway = await gatewayServed({ account: { id: 'A0002' } });
    const policy = connectionPolicyOf({ allowed_hosts: ['127.0.0.1', 'notes.example.com'] });
    const h = gatewayHarnessAt(gateway, { policy });
    const { link } = await connectedThrough(h, gateway);
    const notes = {
      name: 'notes',
      type: 'mcp',
      entry: { url: 'https://notes.example.com/mcp' },
      credential: { kind: 'none' },
    };
    await added(h, notes);

    expect(await h.call(operationNamed(h.operations, 'list_connections'), ada)).toMatchObject({
      output: {
        connections: [
          { name: 'notes', account: null },
          { id: link.id, name: 'messages', account: { id: 'A0002' } },
        ],
      },
    });
  });
});

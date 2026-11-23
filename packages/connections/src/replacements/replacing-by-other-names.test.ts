import { messagesThrough, providerListOf, providerOf } from '@on.auto/providers/testing';
import type { FakeGateway } from '@on.auto/tool-servers/served-fakes';
import { describe, expect, it } from 'vitest';

import { added } from '../testing/additions.ts';
import { startedByAdminsOf } from '../testing/connection-starts.ts';
import { connectedThrough, gatewayHarnessAt, gatewayServed } from '../testing/gateways.ts';
import { ada, grace, operationNamed, recordedAs } from '../testing/harness.ts';
import { pressed } from '../testing/presses.ts';
import { servedAs, sourceOver } from '../testing/served-connections.ts';

function through(gateway: FakeGateway) {
  return messagesThrough({ url: gateway.url, document: gateway.document });
}

function namedRelay(gateway: FakeGateway) {
  return providerListOf(providerOf({ ...through(gateway), name: 'relay' }));
}

function replacingAsMessages(gateway: FakeGateway) {
  return providerListOf(providerOf({ ...through(gateway), aliases: ['relay'], replaces: ['files'] }));
}

function relayed() {
  const gateway = gatewayServed();
  const h = gatewayHarnessAt(gateway, { providers: namedRelay(gateway) });
  return { gateway, h, providers: replacingAsMessages(gateway) };
}

describe('a connection added under a name the provider that replaces another had before', () => {
  it('is that provider’s own: listed and served under its name now, and reconnected with a new link, not added again', async () => {
    const { gateway, h, providers } = relayed();
    const { link } = await connectedThrough(h, gateway, await added(h, { provider: 'relay' }));
    const after = h.operationsWith({ providers });
    const before = (await h.facts()).length;

    const listed = await h.call(operationNamed(after, 'list_connections'), ada);
    const relinked = await h.call(operationNamed(after, 'reconnect_connection'), ada, { id: link.id });

    expect(listed).toMatchObject({ output: { connections: [{ id: link.id, name: 'relay', provider: 'messages' }] } });
    expect((await servedAs(sourceOver(h, { providers }), link.id)).state).toMatchObject({ status: 'connected' });
    expect(relinked).toMatchObject({
      status: 'succeeded',
      output: { id: link.id, name: 'relay', provider: 'messages' },
    });
    expect((await h.facts()).slice(before).map(({ type }) => type)).toEqual(['connection_link_issued']);
  });

  it('left waiting, is given a new link by another person under its name now, the same connection, with no host asked', async () => {
    const { h, providers } = relayed();
    const left = await added(h, { provider: 'relay' });
    const heard = startedByAdminsOf('messages', [ada.id, grace.id]);
    const ops = h.operationsWith({ providers, starts: heard.starts });

    expect(await pressed({ h, ops }, left.id, grace)).toMatchObject({
      status: 'succeeded',
      output: { id: left.id, name: 'relay', provider: 'messages', status: 'pending', added_by: recordedAs.ada },
    });
    expect(heard.asked()).toEqual([]);
  });
});

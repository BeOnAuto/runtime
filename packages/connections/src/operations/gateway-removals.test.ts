import { providerListOf } from '@on.auto/providers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added } from '../testing/additions.ts';
import { connectedThrough, gatewayHarnessAt, gatewayServed, removing } from '../testing/gateways.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

async function typesOf(h: Harness): Promise<readonly string[]> {
  return (await h.facts()).map(({ type }) => type);
}

const removed = 'connection_removed';

const unended =
  'The key of the connection messages could not be ended at its gateway, so the connection is not removed';

const unreachedHost: unknown = expect.stringMatching(
  /^The key of the connection messages could not be ended at its gateway, so the connection is not removed: A connection may not reach the host 127\.0\.0\.1/u,
);

describe('the removal of a connection made through its gateway', () => {
  it('ends its key at the gateway before it records the removal, and forgets the key', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const [key = ''] = gateway.keys();

    const outcome = await removing(h, link.id);

    expect(outcome).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(gateway.ended()).toEqual([key]);
    expect((await typesOf(h)).at(-1)).toBe(removed);
    expect(h.secrets.values().size).toBe(0);
  });

  it('counts a key the gateway no longer knows as ended, so removing it twice removes it once', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    gateway.answering('end', 403, { refused: 'unknown_key' });

    const outcomes = [await removing(h, link.id), await removing(h, link.id)];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { status: 'removed' } },
      { status: 'succeeded', output: { status: 'removed' } },
    ]);
    expect((await typesOf(h)).filter((type) => type === removed)).toHaveLength(1);
  });

  it('ends nothing for a connection that was never connected', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { id } = await added(h, { provider: 'messages' });

    expect(await removing(h, id)).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(gateway.seen().filter(({ path }) => path === '/connections/remove')).toEqual([]);
  });
});

describe('the removal of a connection whose gateway does not confirm the end of its key', () => {
  it('is not recorded, keeps the key, and is recorded once asked again', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    gateway.answering('end', 500);

    const refused = await removing(h, link.id);
    const typesWhileRefused = await typesOf(h);
    const heldWhileRefused = h.secrets.values().size;
    gateway.answeringAsItself('end');
    const again = await removing(h, link.id);

    expect(refused).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail: `${unended}; try again shortly: its gateway did not confirm it`,
    });
    expect([typesWhileRefused.includes(removed), heldWhileRefused]).toEqual([false, 1]);
    expect(again).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect((await typesOf(h)).at(-1)).toBe(removed);
  });

  it('is refused in the rule’s words where the gateway’s host may no longer be reached', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const closed = h.operationsWith({ policy: connectionPolicyOf({ allowed_hosts: ['gateway.example.com'] }) });

    const refused = await h.call(operationNamed(closed, 'remove_connection'), ada, { id: link.id });

    expect(refused).toMatchObject({ status: 'rejected', reason: 'unavailable', detail: unreachedHost });
  });
});

describe('the removal of a connection whose key cannot be ended here', () => {
  it('is refused while the key cannot be read, naming the store’s words', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const unreadable = h.operationsWith({
      secrets: { ...h.secrets, read: () => Effect.fail({ _tag: 'keeper_unavailable', detail: 'The keeper is down' }) },
    });

    expect(await h.call(operationNamed(unreadable, 'remove_connection'), ada, { id: link.id })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail:
        'The key of the connection messages cannot be read now, so it cannot be ended at its gateway and the connection is not removed; try again shortly: The keeper is down',
    });
  });

  it('is refused as having no gateway here on a runtime where gateways are not switched on', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const elsewhere = gatewayHarnessAt(gateway, { gateways: false, ledger: h.ledger });
    const removal = elsewhere.operationsWith({ secrets: h.secrets });

    expect(await elsewhere.call(operationNamed(removal, 'remove_connection'), ada, { id: link.id })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail: `${unended}: The provider messages connects through a service that Auto's cloud runs, which this runtime does not have`,
    });
  });
});

describe('the removal of a connection whose provider names no gateway any more while its key is held', () => {
  it('is refused, keeps the key and records nothing, and removes the connection once the provider names its gateway again', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const unnamed = h.operationsWith({ providers: providerListOf() });

    const refused = await h.call(operationNamed(unnamed, 'remove_connection'), ada, { id: link.id });
    const whileRefused = [(await typesOf(h)).includes(removed), h.secrets.values().size, gateway.ended().length];
    const again = await removing(h, link.id);

    expect(refused).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail: `${unended}: its provider no longer names the gateway it is connected through, which whoever runs this runtime names again before the connection is removed`,
    });
    expect(whileRefused).toEqual([false, 1, 0]);
    expect(again).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(gateway.ended()).toHaveLength(1);
  });
});

describe('the removal of a connection whose key this runtime no longer holds', () => {
  it('removes the connection and logs at the error level, by the org and the connection, that its key was not ended', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const [secretId = ''] = [...h.secrets.values().keys()];
    await Effect.runPromise(h.secrets.forget(secretId));

    const outcome = await removing(h, link.id);

    expect(outcome).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(gateway.ended()).toEqual([]);
    const line = h.logged().find((logged) => logged.includes('"level":"ERROR"'));
    expect(String(line)).toContain(
      'The key of a connection made through a gateway was not ended there, since this runtime no longer holds it; the connection is removed, and nothing here holds the key any more',
    );
    expect(String(line)).toContain(`"annotations":{"org":"acme","connection":"${link.id}"}`);
    expect(String(line)).not.toContain('messages');
  });
});

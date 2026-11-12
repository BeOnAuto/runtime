import type { KeptRow, SecretReadingFailure } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, reconnected } from '../testing/additions.ts';
import { allowedAt, connectedThrough, finishingWith, gatewayHarnessAt, gatewayServed } from '../testing/gateways.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

const errorsOf = (h: Harness) => h.logged().filter((line) => line.includes('"level":"ERROR"'));

function unreadableAt(
  h: Harness,
  unread: string,
): (id: string) => Effect.Effect<KeptRow | undefined, SecretReadingFailure> {
  const failing = Effect.fail<SecretReadingFailure>({ _tag: 'keeper_unavailable', detail: 'The keeper is down' });
  return (id) => (id === unread ? failing : h.secrets.read(id));
}

describe('a connection connected again through its gateway', () => {
  it('ends the key it held at the gateway only once the new key is recorded, and keeps working on the new one', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const [first = ''] = gateway.keys();
    const relinked = await reconnected(h, link.id);
    const returned = await allowedAt(h, gateway, relinked);
    const keptBefore = gateway.keys();

    const outcome = await finishingWith(h, relinked, returned);

    expect(keptBefore).toEqual([first]);
    expect(outcome).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect([gateway.ended(), gateway.keys().length]).toEqual([[first], 1]);
    expect([...h.secrets.values().values()]).toEqual(gateway.keys());
  });

  it('tries three times to end the key it held, then logs at the error level and stays connected on the new key', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    gateway.answering('end', 503);
    const relinked = await reconnected(h, link.id);

    const outcome = await finishingWith(h, relinked, await allowedAt(h, gateway, relinked));

    expect(outcome).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(gateway.seen().filter(({ path }) => path === '/connections/remove')).toHaveLength(3);
    const [line = ''] = errorsOf(h);
    expect(errorsOf(h)).toHaveLength(1);
    expect(line).toContain(
      'The key a connection held before it was connected again was not confirmed ended at its gateway; nothing here holds it any more',
    );
    expect(line).toContain(`"annotations":{"org":"acme","connection":"${link.id}"}`);
    expect(h.secrets.values().size).toBe(1);
  });
});

describe('a connection connected again whose earlier key the runtime cannot read or no longer holds', () => {
  it('logs at the error level that the earlier key was not ended, and stays connected on the new key', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const second = await connectedThrough(h, gateway, await added(h, { provider: 'messages', name: 'messages-two' }));
    const [firstKey = '', secondKey = ''] = [...h.secrets.values().keys()];
    await Effect.runPromise(h.secrets.forget(firstKey));
    const unreadable = h.operationsWith({ secrets: { ...h.secrets, read: unreadableAt(h, secondKey) } });
    const first = await reconnected(h, link.id);
    const firstReturned = await allowedAt(h, gateway, first);
    const again = await reconnected(h, second.link.id);
    const againReturned = await allowedAt(h, gateway, again);

    const outcomes = [
      await finishingWith(h, first, firstReturned),
      await h.call(operationNamed(unreadable, 'finish'), ada, { id: again.id, token: again.token, ...againReturned }),
    ];

    expect(outcomes).toMatchObject([
      { status: 'succeeded', output: { status: 'connected' } },
      { status: 'succeeded', output: { status: 'connected' } },
    ]);
    expect([gateway.ended(), h.secrets.values().size]).toEqual([[], 2]);
    expect(errorsOf(h)).toEqual([
      expect.stringContaining(`"connection":"${link.id}"`),
      expect.stringContaining(`"connection":"${second.link.id}"`),
    ]);
    expect(errorsOf(h).join('')).not.toContain('messages');
  });
});

describe('a finish through a gateway that fails after the hand-off', () => {
  it('ends the key it was just handed, and leaves the connection as it was', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const link = await added(h, { provider: 'messages' });
    const returned = await allowedAt(h, gateway, link);
    const unkeeping = h.operationsWith({
      secrets: { ...h.secrets, keep: () => Effect.fail({ _tag: 'keeper_unavailable', detail: 'The keeper is down' }) },
    });

    const outcome = await h.call(operationNamed(unkeeping, 'finish'), ada, {
      id: link.id,
      token: link.token,
      ...returned,
    });

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'unavailable' });
    expect([gateway.keys(), gateway.ended().length]).toEqual([[], 1]);
    expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_connected');
  });
});

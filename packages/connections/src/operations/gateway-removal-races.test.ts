import type { ConsentClientOptions } from '@on.auto/tool-servers';
import { describe, expect, it, vi } from 'vitest';

import { reconnected } from '../testing/additions.ts';
import {
  allowedAt,
  connectedThrough,
  finishingWith,
  gatewayHarnessAt,
  gatewayServed,
  removing,
} from '../testing/gateways.ts';

interface GatedEnds {
  readonly fetch: ConsentClientOptions['fetch'];
  readonly holding: () => boolean;
  readonly release: () => void;
}

function firstEndHeld(): GatedEnds {
  const opened = Promise.withResolvers<void>();
  const held = { first: false };
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      const url = String(address);
      if (url.endsWith('/connections/remove') && !held.first) {
        held.first = true;
        await opened.promise;
      }
      return globalThis.fetch(url, Object.assign({}, init));
    },
    holding: () => held.first,
    release: opened.resolve,
  };
}

describe('a removal that a finish connecting the connection again overtakes', () => {
  it('ends the newer key too, so no key the connection held is left at the gateway', async () => {
    const gateway = await gatewayServed();
    const gate = firstEndHeld();
    const h = gatewayHarnessAt(gateway, { consenting: { fetch: gate.fetch } });
    const { link } = await connectedThrough(h, gateway);
    const [first = ''] = gateway.keys();
    const relinked = await reconnected(h, link.id);
    const returned = await allowedAt(h, gateway, relinked);

    const removal = removing(h, link.id);
    await vi.waitFor(() => {
      expect(gate.holding()).toBe(true);
    });
    const reconnection = await finishingWith(h, relinked, returned);
    const [second = ''] = gateway.keys();
    gate.release();
    const outcome = await removal;

    expect([reconnection, outcome]).toMatchObject([
      { status: 'succeeded', output: { status: 'connected' } },
      { status: 'succeeded', output: { status: 'removed' } },
    ]);
    expect(gateway.keys()).toEqual([]);
    expect(gateway.ended()).toEqual([first, second]);
    expect(h.secrets.values().size).toBe(0);
  });
});

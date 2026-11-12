import { providerListOf } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { added } from '../testing/additions.ts';
import { starting } from '../testing/consents.ts';
import { allowedAt, finishingWith, gatewayHarnessAt, gatewayServed } from '../testing/gateways.ts';
import { ada, operationNamed } from '../testing/harness.ts';

describe('a start through a gateway the gateway refuses or no gateway takes', () => {
  it('is refused in words that name the gateway, or that say this runtime has none, and the connection stays as it was', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const link = await added(h, { provider: 'messages' });
    const elsewhere = h.operationsWith({ consent: gatewayHarnessAt(gateway, { gateways: false }).consent });
    const unnamed = h.operationsWith({ providers: providerListOf() });
    gateway.answering('start', 400, { refused: 'state' });

    const refusals = [
      await starting(h, link),
      await h.call(operationNamed(elsewhere, 'start'), ada, { id: link.id, token: link.token }),
      await h.call(operationNamed(unnamed, 'start'), ada, { id: link.id, token: link.token }),
    ];

    expect(refusals).toMatchObject([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The gateway of the connection messages refused to start its consent',
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail:
          "The provider messages connects through a service that Auto's cloud runs, which this runtime does not have",
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail:
          'The provider of the connection messages no longer names the gateway it is connected through; whoever runs this runtime names it again before the connection is connected or removed',
      },
    ]);
    expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_consent_started');
  });
});

describe('a finish through a gateway given what the gateway does not take', () => {
  it('refuses a code where the consent began through the gateway, and a handle the gateway refuses, at the field', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const link = await added(h, { provider: 'messages' });
    const { state } = await allowedAt(h, gateway, link);

    const refusals = [
      await finishingWith(h, link, { state, code: 'a-code' }),
      await finishingWith(h, link, { state, handle: 'a-handle-the-gateway-never-gave' }),
    ];

    expect(refusals).toMatchObject([
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [
          {
            pointer: '/code',
            detail:
              'Expected handle: the consent of the connection messages began through its gateway, which answers a handle, not a code',
          },
        ],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '/handle', detail: 'Expected a handle its gateway takes; it refused this one' }],
      },
    ]);
    expect(gateway.keys()).toEqual([]);
  });
});

describe('a finish whose gateway hands over a key with an account the runtime does not take', () => {
  it('ends the key it was handed, connects nothing, and keeps the account of no connection', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const link = await added(h, { provider: 'messages' });
    const returned = await allowedAt(h, gateway, link);
    gateway.answering('handoff', 200, { connection_key: 'a-handed-key', account: { id: '' } });

    const outcome = await finishingWith(h, link, returned);

    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The gateway of the connection messages handed over an account or a scope this runtime does not take, so the connection is not connected and the person starts again',
    });
    expect(
      gateway
        .seen()
        .filter(({ path }) => path === '/connections/remove')
        .map(({ body }) => body),
    ).toEqual([JSON.stringify({ connection_key: 'a-handed-key' })]);
    expect((await h.facts()).map(({ type }) => type)).not.toContain('connection_connected');
  });
});

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProviderEntrySchema } from '../entry/provider-entry.ts';
import { eventDestinationOf, joinedProviders, providersShippedRoots, readProviders } from '../index.ts';
import { overASocket } from '../testing/event-destinations.ts';
import { tracker } from '../testing/index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const declaring = shipped.providers.filter(({ entry }) => entry.events !== undefined);

describe('the events parts of the shipped providers', () => {
  it('are written for Slack alone, whose app sends what happens to the address set once on the app', () => {
    expect(
      declaring.map(({ entry }) => [entry.name, entry.events?.destinations.map(({ type, per }) => [type, per])]),
    ).toEqual([['slack', [['webhook', 'app']]]]);
  });

  it("say where Slack's event names the conversation its message was posted in, and the message an app posted", () => {
    expect(eventDestinationOf(shipped, 'slack', 'webhook')).toMatchObject({
      verify: {
        scheme: 'hmac',
        secret: 'app',
        signed_payload: 'v0:{timestamp}:{payload}',
        signature: '$request.header.X-Slack-Signature',
        timestamp: '$request.header.X-Slack-Request-Timestamp',
      },
      wake: {
        when: { '$request.body#/type': ['event_callback'], '$request.body#/event/type': ['message'] },
        conversation: '$request.body#/event/channel',
        automatic: '$request.body#/event/bot_id',
      },
      connection: { account: '$request.body#/team_id' },
    });
  });
});

describe('the destination of a provider', () => {
  it('is answered for a provider and a type, and for a type it does not declare, a server added by hand or a provider unknown, not at all', () => {
    const asked: readonly (readonly [string | null, 'webhook' | 'websocket' | 'queue'])[] = [
      ['slack', 'websocket'],
      ['slack', 'queue'],
      [null, 'webhook'],
      ['slack-bot', 'webhook'],
      ['unknown', 'webhook'],
    ];

    expect(asked.map(([provider, type]) => eventDestinationOf(shipped, provider, type))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('is that of a provider whoever runs the runtime adds, in place of a shipped one of the same name', () => {
    const added = Schema.decodeUnknownSync(ProviderEntrySchema)({
      ...tracker,
      name: 'slack',
      events: { destinations: [overASocket] },
    });
    const joined = joinedProviders(shipped, [added]);

    expect(eventDestinationOf(joined, 'slack', 'websocket')).toMatchObject({ type: 'websocket' });
    expect(eventDestinationOf(joined, 'slack', 'webhook')).toBeUndefined();
  });
});

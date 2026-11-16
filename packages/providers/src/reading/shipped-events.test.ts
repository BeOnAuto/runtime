import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProviderEntrySchema } from '../entry/provider-entry.ts';
import { eventDestinationOf, joinedProviders, providersShippedRoots, readProviders } from '../index.ts';
import { overASocket } from '../testing/event-destinations.ts';
import { tracker } from '../testing/index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const declaring = shipped.providers.filter(({ entry }) => entry.events !== undefined);

const hearing = (name: string) =>
  joinedProviders(shipped, [
    Schema.decodeUnknownSync(ProviderEntrySchema)({ ...tracker, name, events: { destinations: [overASocket] } }),
  ]);

describe('the events parts of the shipped providers', () => {
  it('are written by none of them, so a provider that hears what its service sends is one whoever runs the runtime adds', () => {
    expect(declaring).toEqual([]);
  });
});

describe('the destination of a provider', () => {
  it('is answered for a provider and a type it declares', () => {
    expect(eventDestinationOf(hearing('team-chat'), 'team-chat', 'websocket')).toMatchObject({ type: 'websocket' });
  });

  it('is answered for a type it does not declare, a server added by hand or a provider unknown, not at all', () => {
    const joined = hearing('team-chat');
    const asked: readonly (readonly [string | null, 'webhook' | 'websocket' | 'queue'])[] = [
      ['team-chat', 'webhook'],
      ['team-chat', 'queue'],
      [null, 'webhook'],
      ['slack-bot', 'webhook'],
      ['unknown', 'webhook'],
    ];

    expect(asked.map(([provider, type]) => eventDestinationOf(joined, provider, type))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('is that of a provider whoever runs the runtime adds, in place of a shipped one of the same name', () => {
    const joined = hearing('slack-bot');

    expect(eventDestinationOf(joined, 'slack-bot', 'websocket')).toMatchObject({ type: 'websocket' });
    expect(eventDestinationOf(shipped, 'slack-bot', 'websocket')).toBeUndefined();
  });
});

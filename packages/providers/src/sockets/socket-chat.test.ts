import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventDestinationOf } from '../reading/provider-list.ts';
import { chatOverASocket } from '../testing/chat-destinations.ts';
import { providersOf } from '../testing/fixture-providers.ts';
import { listenedOver, settled, type Hearer } from '../testing/socket-servers.ts';

const recorded: Hearer = (record) => (arrival) => Effect.sync(() => record(arrival));

describe('a message a person wrote, over the socket', () => {
  it('is handed on with what the destination reads of it, though the reading holds nothing else', async () => {
    const destination = Option.getOrThrow(
      Option.fromNullishOr(eventDestinationOf(providersOf(chatOverASocket), 'tracker', 'websocket')),
    );
    const written = { id: 'm2', room: 'r1', author: 'ada', text: 'How are the sales?' };
    const heard = await listenedOver({ destination, credential: 'app-value', hearer: recorded }, ({ sends }) =>
      sends(JSON.stringify({ kind: 'mention', space: 's1', room: { shared: false }, message: written })).pipe(
        Effect.andThen(settled),
      ),
    );

    expect(heard.arrivals.map(({ chat }) => [chat?.kind, chat?.conversation, chat?.sender])).toEqual([
      ['mention', 'r1', 'ada'],
    ]);
  });
});

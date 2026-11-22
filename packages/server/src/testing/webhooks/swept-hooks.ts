import { firstReadWaitMs } from '@on.auto/interaction/testing';
import type { FakeMcpServer } from '@on.auto/tool-servers/served-fakes';

import { hookMadeAt, type MadeHook } from '../interaction-servers/room-events.ts';
import type { ReasoningServer } from '../servers/reasoning-server.ts';
import { isStarted, whenSwept } from '../servers/workflow-server.ts';
import { ownClockOf, type SteppedServerClock } from '../waiting/stepped-server-clock.ts';

type SteppedServer = Pick<ReasoningServer, 'call'> & { readonly clock?: SteppedServerClock };

/**
 * The webhook the server arranged at the rooms service. A subscription round runs on the server's next sweep after its
 * connections change, so its sweeps are stepped, a few at most, until the service holds the hook.
 */
export async function hookSweptAt(server: SteppedServer, rooms: FakeMcpServer): Promise<MadeHook> {
  await whenSwept(
    server,
    () => rooms.received().filter(({ tool }) => tool === 'create_hook').length,
    (count) => count > 0,
  );
  return hookMadeAt(rooms);
}

/** The request's post in the room, which the server sends from a run its sweep starts: its sweeps are stepped. */
export async function postedSwept(server: SteppedServer, rooms: FakeMcpServer): Promise<void> {
  await whenSwept(
    server,
    () => rooms.chat.posted(),
    (posted) => posted.length > 0,
  );
}

/**
 * The run once it ended, its replies read on the server's timer: the time is stepped by the first wait before a read of
 * replies, twice at most, since the read that finds the reply falls due within one wait of the request's post.
 */
export async function settledByAReplyRead(server: SteppedServer, path: string): Promise<unknown> {
  const ended = await ownClockOf(server)
    .steppedEvery(firstReadWaitMs)
    .until(
      () => server.call('GET', path),
      ({ body }) => !isStarted(body),
      { atMost: 2 },
    );
  return ended.body;
}

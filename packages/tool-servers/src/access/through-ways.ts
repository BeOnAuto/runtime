import { Effect } from 'effect';

import type { CalledOnce } from '../one-call/called-once.ts';
import type { ReadCall } from '../one-call/one-call.ts';
import { linkedOf, stopped, type Linking } from '../org-servers/connection-links.ts';
import type { ConnectionServer } from '../org-servers/connection-source.ts';
import { readyAsItIs, type OrgServer } from '../org-servers/org-servers.ts';
import type { LinkedAccess } from './linked-access.ts';

export interface ServerThrough {
  readonly connection: string;
  readonly server: ConnectionServer;
}

export type ReadOnceThrough = (call: ReadCall, through: ServerThrough) => Effect.Effect<CalledOnce>;

export interface ThroughWays {
  readonly readOnceThrough: ReadOnceThrough;
}

function serverThrough({ connection, server }: ServerThrough, linking: Linking): OrgServer {
  return {
    settings: { ...server.settings, connection },
    keptAs: undefined,
    checked: readyAsItIs,
    linked: () => Promise.resolve(linkedOf(linking)),
  };
}

export function throughWaysOf(loaded: () => Promise<Pick<LinkedAccess, 'connectionLink' | 'readOnce'>>): ThroughWays {
  return {
    readOnceThrough: (call, through) =>
      Effect.flatMap(Effect.promise(loaded), (linked) =>
        Effect.acquireUseRelease(
          Effect.promise(() => linked.connectionLink(through.connection, through.server)),
          (linking) => linked.readOnce(call, serverThrough(through, linking)),
          (linking) => Effect.promise(() => stopped(Promise.resolve(linking))),
        ),
      ),
  };
}

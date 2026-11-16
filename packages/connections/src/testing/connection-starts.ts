import { Caller, Unavailable } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { ConnectionStart, ConnectionStarts } from '../policy/connection-starts.ts';

export const adminsAlone = 'Only an admin of acme connects messages here. Ask one of them.';

export const startsUnread = 'Whether the caller is an admin of acme cannot be read just now';

type Asked = readonly [provider: string, caller: string | undefined];

interface StartsHeard {
  readonly starts: ConnectionStarts;
  readonly asked: () => readonly Asked[];
}

function startFor(admins: readonly string[], caller: string | undefined): ConnectionStart {
  return caller !== undefined && admins.includes(caller) ? 'may take over' : { refused: adminsAlone };
}

export function startedByAdminsOf(provider: string, admins: readonly string[]): StartsHeard {
  const heard: Asked[] = [];
  const starts: ConnectionStarts = (asked) =>
    Effect.gen(function* () {
      const id = Option.getOrUndefined(Option.map(yield* Effect.serviceOption(Caller), ({ id: who }) => who));
      heard.push([asked, id]);
      return asked === provider ? startFor(admins, id) : 'anyone';
    });
  return { starts, asked: () => [...heard] };
}

export const startsNotSaid: ConnectionStarts = () => Effect.fail(new Unavailable({ detail: startsUnread }));

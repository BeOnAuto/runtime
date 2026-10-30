import { Array as Arr, Effect, Option } from 'effect';

import type { StartedFields } from '../calls/recorded-calls.ts';
import { notOfferedOnce, type CalledOnce } from '../one-call/called-once.ts';
import type { CallOnce, OneCall, RunCall } from '../one-call/one-call.ts';
import type { OrgAccess } from '../org-servers/org-access.ts';
import { namedAmong } from '../org-servers/org-naming.ts';
import { namedIn, type OrgServer } from '../org-servers/org-servers.ts';
import { startedOn, type RecordingParts } from './entry-reads.ts';
import type { ToolNotOffered } from './tool-not-offered.ts';

export interface PreparedCall {
  readonly fields: StartedFields;
  readonly called: Effect.Effect<CalledOnce>;
}

export interface CallWays {
  readonly callOnce: CallOnce;
  readonly preparedCall: (call: OneCall) => Effect.Effect<PreparedCall>;
}

function calledAmong(access: OrgAccess, servers: readonly OrgServer[], call: OneCall, runCall?: RunCall) {
  return Effect.matchEffect(namedAmong(servers, { address: call, references: [call.reference] }), {
    onFailure: (refusal: Pick<ToolNotOffered, 'because' | 'detail'>) => Effect.succeed(notOfferedOnce(refusal)),
    onSuccess: (named) =>
      Effect.flatMap(Effect.promise(access.loaded), (linkedAccess) =>
        linkedAccess.callOnce(call, Option.getOrThrow(Arr.head(named)), runCall),
      ),
  });
}

function startedAmong(servers: readonly OrgServer[], call: OneCall, recording: RecordingParts) {
  const server = namedIn(call.org, servers).get(call.reference.server);
  return Effect.promise(async () => {
    await server?.checked();
    return startedOn(server?.settings, call, recording);
  });
}

export function callWaysOf(access: OrgAccess, recording: RecordingParts): CallWays {
  return {
    callOnce: (call, runCall) =>
      Effect.flatMap(access.serversOf(call.org), (servers) => calledAmong(access, servers, call, runCall)),
    preparedCall: (call) =>
      Effect.flatMap(access.serversOf(call.org), (servers) =>
        Effect.map(startedAmong(servers, call, recording), (fields) => ({
          fields,
          called: calledAmong(access, servers, call),
        })),
      ),
  };
}

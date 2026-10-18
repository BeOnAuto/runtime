import { Effect } from 'effect';

import { recordingOf, type CallJournal, type KeepIn } from '../calls/recorded-calls.ts';
import { journalledCall, type CallJournalling } from '../calls/tool-caller.ts';
import type { ServerLink } from '../clients/server-links.ts';
import type { Listing } from '../listing/server-listing.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { OrgServer } from '../org-servers/org-servers.ts';
import { openedFor } from './call-opening.ts';
import { answeredOnce, refusedOnce, tracedOnce, type CalledOnce } from './called-once.ts';

export interface OneCall {
  readonly org: string;
  readonly playbook: string;
  readonly reference: ToolReference;
  readonly input: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, string>>;
  readonly longestRetryWaitMs?: number;
}

export interface RunCall {
  readonly callId: string;
  readonly journal: CallJournal;
}

export type CallOnce = (call: OneCall, runCall?: RunCall) => Effect.Effect<CalledOnce>;

export interface OneCallAccess extends Listing {
  readonly keepIn: KeepIn;
}

type Journalling = (readOnly: boolean) => CallJournalling;

interface Calling {
  readonly access: OneCallAccess;
  readonly journalling: Journalling | undefined;
  readonly signal: Readonly<AbortSignal>;
}

const notRecorded = 'The start of the call could not be recorded on its run, so the call was not sent';

async function calledOnce(call: OneCall, link: ServerLink, { access, journalling, signal }: Calling) {
  const opened = await openedFor(call.reference, link, access);
  if ('kind' in opened) {
    return opened;
  }
  const { slot, tool, readOnly } = opened;
  const recording = recordingOf(link.settings, access.secrets, access.keepIn(call));
  const { callMs } = access.timing;
  const longestRetryWaitMs = Math.min(call.longestRetryWaitMs ?? 0, access.timing.longestRetryWaitMs);
  const forwarding = { slot, tool: tool.name, input: call.input, meta: call.meta, callMs, longestRetryWaitMs, signal };
  try {
    const journey = await journalledCall(forwarding, recording, journalling?.(readOnly));
    if (!journey.sent) {
      throw new Error(notRecorded);
    }
    return answeredOnce(journey, access.secrets.scrub, tool.annotations);
  } finally {
    await slot.release();
  }
}

async function linkedAndCalled(call: OneCall, server: OrgServer, calling: Calling): Promise<CalledOnce> {
  const linked = await server.linked();
  return 'refused' in linked ? refusedOnce(linked.refused) : calledOnce(call, linked.link, calling);
}

type Awaiting = <A>(effect: Effect.Effect<A>) => Promise<A>;

function journallingOf(runCall: RunCall | undefined, awaited: Awaiting): Journalling | undefined {
  return runCall === undefined
    ? undefined
    : (readOnly) => ({
        callId: runCall.callId,
        readOnly,
        started: (fact) => awaited(runCall.journal.started(fact)),
        ended: async (number, fact) => {
          await awaited(runCall.journal.ended(number, fact));
        },
      });
}

export function oneCall(
  call: OneCall,
  server: OrgServer,
  access: OneCallAccess,
  runCall?: RunCall,
): Effect.Effect<CalledOnce> {
  return tracedOnce(
    { server: server.settings.name, tool: call.reference.tool },
    server.settings,
    Effect.gen(function* () {
      const journalling = journallingOf(runCall, Effect.runPromiseWith(yield* Effect.context()));
      return yield* Effect.promise((signal) => linkedAndCalled(call, server, { access, journalling, signal }));
    }),
  );
}

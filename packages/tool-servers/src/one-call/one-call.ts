import type { AssetHolding, CallMeta } from '@on.auto/operations';
import { Effect } from 'effect';

import { recordingOf, type CallJournal, type KeepIn } from '../calls/recorded-calls.ts';
import { journalledCall, type CallJournalling } from '../calls/tool-caller.ts';
import type { Listing } from '../listing/server-listing.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { Linked, OrgServer } from '../org-servers/org-servers.ts';
import { admittedOnce } from './call-admission.ts';
import { openedFor, type Opened } from './call-opening.ts';
import { answeredOnce, refusedOnce, tracedOnce, type CalledOnce } from './called-once.ts';

export interface OneCall {
  readonly org: string;
  readonly playbook: string;
  readonly reference: ToolReference;
  readonly input: Readonly<Record<string, unknown>>;
  readonly meta: CallMeta;
  readonly longestRetryWaitMs?: number;
  readonly requiredMark?: 'reads';
}

export interface RunCall {
  readonly callId: string;
  readonly journal: CallJournal;
}

export type CallOnce = (call: OneCall, runCall?: RunCall) => Effect.Effect<CalledOnce>;

export interface OneCallAccess extends Listing {
  readonly keepIn: KeepIn;
  readonly assets: AssetHolding;
  readonly mostRequestBytes: number;
}

type Journalling = (readOnly: boolean) => CallJournalling;

type Awaiting = <A>(effect: Effect.Effect<A>) => Promise<A>;

interface Calling {
  readonly access: OneCallAccess;
  readonly journalling: Journalling | undefined;
  readonly signal: Readonly<AbortSignal>;
  readonly awaited: Awaiting;
}

const notRecorded = 'The start of the call could not be recorded on its run, so the call was not sent';

type LinkedServer = Extract<Linked, { readonly link: unknown }>;

async function sentOnce(call: OneCall, link: LinkedServer['link'], opened: Opened, calling: Calling) {
  const { access, journalling, signal } = calling;
  const { slot, tool, readOnly } = opened;
  const assets = await admittedOnce(call, opened, { ...access, awaited: calling.awaited });
  if ('kind' in assets) {
    return assets;
  }
  const recording = recordingOf(link.settings, access.secrets, access.keepIn(call));
  const { callMs } = access.timing;
  const longestRetryWaitMs = Math.min(call.longestRetryWaitMs ?? 0, access.timing.longestRetryWaitMs);
  const forwarding = {
    slot,
    tool: tool.name,
    input: call.input,
    assets,
    meta: call.meta,
    callMs,
    longestRetryWaitMs,
    signal,
  };
  const journey = await journalledCall(forwarding, recording, journalling?.(readOnly));
  if (!journey.sent) {
    throw new Error(notRecorded);
  }
  return answeredOnce(journey, access.secrets.scrub, tool.mark);
}

async function calledOnce(call: OneCall, { link }: LinkedServer, calling: Calling): Promise<CalledOnce> {
  const opened = await openedFor(call.reference, link, calling.access);
  if ('kind' in opened) {
    return opened;
  }
  try {
    return await sentOnce(call, link, opened, calling);
  } finally {
    await opened.slot.release();
  }
}

async function linkedAndCalled(call: OneCall, server: OrgServer, calling: Calling): Promise<CalledOnce> {
  const linked = await server.linked();
  return 'refused' in linked ? refusedOnce(linked.refused) : calledOnce(call, linked, calling);
}

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
      const awaited = Effect.runPromiseWith(yield* Effect.context());
      const journalling = journallingOf(runCall, awaited);
      return yield* Effect.promise((signal) => linkedAndCalled(call, server, { access, journalling, signal, awaited }));
    }),
  );
}

import type { AssetHolding, CallMeta } from '@on.auto/operations';
import { Effect } from 'effect';

import {
  recordingOf,
  type CallJournal,
  type KeepContent,
  type KeepIn,
  type Recording,
} from '../calls/recorded-calls.ts';
import { journalledCall, type CallJournalling } from '../calls/tool-caller.ts';
import type { Listing } from '../listing/server-listing.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { Linked, OrgServer } from '../org-servers/org-servers.ts';
import { admittedAsTheConnection, admittedOnce, notReadOnlyOnce } from './call-admission.ts';
import { openedFor, type Opened } from './call-opening.ts';
import { answeredOnce, refusedOnce, tracedOnce, type CalledOnce, type UnopenedOnce } from './called-once.ts';

export interface OneCall {
  readonly org: string;
  readonly playbook: string;
  readonly reference: ToolReference;
  readonly input: Readonly<Record<string, unknown>>;
  readonly meta: CallMeta;
  readonly longestRetryWaitMs?: number;
  readonly requiredMark?: 'reads';
  readonly recordContent?: false;
}

export function recordingAsTheCallAsks(
  recording: Recording,
  { recordContent }: Pick<OneCall, 'recordContent'>,
): Recording {
  return recordContent === false ? { ...recording, content: false, detail: false } : recording;
}

export interface ReadCall extends Pick<OneCall, 'org' | 'reference' | 'meta'> {
  readonly input?: OneCall['input'];
}

export type OwnCall = Pick<OneCall, 'org' | 'reference' | 'input'>;

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

type Forwarded = Pick<OneCall, 'reference' | 'input' | 'meta' | 'longestRetryWaitMs'>;

type LinkedServer = Extract<Linked, { readonly link: unknown }>;

interface Admitted {
  readonly assets: Exclude<Awaited<ReturnType<typeof admittedOnce>>, UnopenedOnce>;
  readonly recording: Recording;
}

type Admit = (opened: Opened, link: LinkedServer['link']) => Promise<Admitted | UnopenedOnce>;

interface Calling {
  readonly access: OneCallAccess;
  readonly journalling: Journalling | undefined;
  readonly signal: Readonly<AbortSignal>;
  readonly awaited: Awaiting;
  readonly admit: Admit;
}

const notRecorded = 'The start of the call could not be recorded on its run, so the call was not sent';

async function sentOnce(call: Forwarded, link: LinkedServer['link'], opened: Opened, calling: Calling) {
  const { access, journalling, signal } = calling;
  const { slot, tool, readOnly } = opened;
  const admitted = await calling.admit(opened, link);
  if ('kind' in admitted) {
    return admitted;
  }
  const { assets, recording } = admitted;
  const longestRetryWaitMs = Math.min(call.longestRetryWaitMs ?? 0, access.timing.longestRetryWaitMs);
  const forwarding = {
    ...access.timing,
    slot,
    tool: tool.name,
    input: call.input,
    assets,
    meta: call.meta,
    longestRetryWaitMs,
    signal,
  };
  const journey = await journalledCall(forwarding, recording, journalling?.(readOnly));
  if (!journey.sent) {
    throw new Error(notRecorded);
  }
  return answeredOnce(journey, access.secrets.scrub, tool.mark);
}

async function calledOnce(call: Forwarded, { link }: LinkedServer, calling: Calling): Promise<CalledOnce> {
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

async function linkedAndCalled(call: Forwarded, server: OrgServer, calling: Calling): Promise<CalledOnce> {
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

function admittingOf(call: OneCall, access: OneCallAccess, awaited: Awaiting): Admit {
  return async (opened, link) => {
    const assets = await admittedOnce(call, opened, { ...access, awaited });
    return 'kind' in assets
      ? assets
      : {
          assets,
          recording: recordingAsTheCallAsks(recordingOf(link.settings, access.secrets, access.keepIn(call)), call),
        };
  };
}

export const keptNowhere: KeepContent = () => Promise.reject(new Error('A call that records no content keeps none'));

function recordingNothing(link: LinkedServer['link'], access: OneCallAccess): Recording {
  return recordingAsTheCallAsks(recordingOf(link.settings, access.secrets, keptNowhere), { recordContent: false });
}

function readingOf({ reference }: ReadCall, access: OneCallAccess): Admit {
  return ({ tool }, link) =>
    Promise.resolve(
      tool.mark === 'reads'
        ? { assets: [], recording: recordingNothing(link, access) }
        : notReadOnlyOnce(reference, tool.mark),
    );
}

function owningOf({ input }: OwnCall, access: OneCallAccess): Admit {
  return (opened, link) => {
    const assets = admittedAsTheConnection(input, opened, access.mostRequestBytes);
    return Promise.resolve('kind' in assets ? assets : { assets, recording: recordingNothing(link, access) });
  };
}

interface Admitting {
  readonly access: OneCallAccess;
  readonly admitting: (awaited: Awaiting) => Admit;
  readonly runCall?: RunCall | undefined;
}

function calledThrough(
  call: Forwarded,
  server: OrgServer,
  { access, admitting, runCall }: Admitting,
): Effect.Effect<CalledOnce> {
  return tracedOnce(
    { server: server.settings.name, tool: call.reference.tool },
    server.settings,
    Effect.gen(function* () {
      const awaited = Effect.runPromiseWith(yield* Effect.context());
      const journalling = journallingOf(runCall, awaited);
      const admit = admitting(awaited);
      return yield* Effect.promise((signal) =>
        linkedAndCalled(call, server, { access, journalling, signal, awaited, admit }),
      );
    }),
  );
}

export function oneCall(
  call: OneCall,
  server: OrgServer,
  access: OneCallAccess,
  runCall?: RunCall,
): Effect.Effect<CalledOnce> {
  return calledThrough(call, server, { access, admitting: (awaited) => admittingOf(call, access, awaited), runCall });
}

export function readOnce(call: ReadCall, server: OrgServer, access: OneCallAccess): Effect.Effect<CalledOnce> {
  const { input = {} } = call;
  return calledThrough({ ...call, input }, server, { access, admitting: () => readingOf(call, access) });
}

export function ownCallOnce(call: OwnCall, server: OrgServer, access: OneCallAccess): Effect.Effect<CalledOnce> {
  return calledThrough({ ...call, meta: {} }, server, { access, admitting: () => owningOf(call, access) });
}

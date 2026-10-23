import { admission } from '../bounds/call-bounds.ts';
import { answerOf, isReadOnly } from '../bounds/tool-results.ts';
import type { CallAnswered, CallEnded, CallFailed, CallStarted } from './call-facts.ts';
import {
  callReplyOf,
  failureCounted,
  replyOf,
  reportedFailure,
  unsentReply,
  type CallReply,
  type Replying,
  type ToolReply,
} from './call-replies.ts';
import {
  answeredFields,
  failedData,
  recordingOf,
  scrubbedJsonOf,
  startedFields,
  type Recording,
} from './recorded-calls.ts';
import type { CallSignals, NamedOffer, RunState, RunToolsParts, ToolCallRequest } from './run-parts.ts';
import {
  forwarded,
  type Delivered,
  type FailedCall,
  type Forwarded,
  type Forwarding,
  type ScrubbedAnswer,
} from './tool-calls.ts';

const notRecorded = unsentReply('This call could not be recorded on its run, so it was not sent; answer without it.');

const notSent = unsentReply('The run has ended, so this call was not sent.');

export interface CallJournalling {
  readonly callId: string;
  readonly readOnly: boolean;
  readonly started: (fact: CallStarted) => Promise<number | undefined>;
  readonly ended: (number: number, fact: CallEnded) => Promise<void>;
}

interface ForwardedOnce {
  readonly done: Delivered;
  readonly durationMs: number;
}

export type SentCall =
  | { readonly sent: true; readonly answered: true; readonly done: ScrubbedAnswer; readonly fact: CallAnswered }
  | { readonly sent: true; readonly answered: false; readonly done: FailedCall; readonly fact: CallFailed };

export type JournalledCall = SentCall | { readonly sent: false };

export type ShownBytesOf = (sent: ForwardedOnce) => number | undefined;

const unsent: JournalledCall = { sent: false };

function scrubbedOf(done: Forwarded, recording: Recording): Delivered {
  if (done.resultJson === null) {
    return done;
  }
  const keptJson = scrubbedJsonOf(done.resultJson, recording);
  return { ...done, keptJson, scrubbed: answerOf(keptJson) };
}

async function forwardedOnce(forwarding: Forwarding, recording: Recording): Promise<ForwardedOnce> {
  const began = performance.now();
  const done = await forwarded(forwarding);
  return { done: scrubbedOf(done, recording), durationMs: Math.round(performance.now() - began) };
}

type StartingCall = Pick<Forwarding, 'slot' | 'tool' | 'input'>;

async function startOf(
  { slot, tool, input }: StartingCall,
  recording: Recording,
  { callId, readOnly }: Pick<CallJournalling, 'callId' | 'readOnly'>,
): Promise<CallStarted> {
  const fields = await startedFields({ server: slot.settings.name, tool, input }, recording);
  return { call_id: callId, ...fields, ...(readOnly ? { read_only: true } : {}) };
}

async function settledOf(sent: ForwardedOnce, recording: Recording, shownBytes?: number): Promise<SentCall> {
  const { done, durationMs } = sent;
  if (!('keptJson' in done)) {
    return {
      sent: true,
      answered: false,
      done,
      fact: failedData({ ...done, because: done.outcome }, durationMs, recording),
    };
  }
  const fact: CallAnswered = {
    is_error: done.outcome === 'tool_error',
    ...(await answeredFields(done, recording)),
    ...(shownBytes === undefined ? {} : { shown_bytes: shownBytes }),
    duration_ms: durationMs,
  };
  return { sent: true, answered: true, done, fact };
}

function endedOf(sent: SentCall): CallEnded {
  return sent.answered
    ? { type: 'tool_call_answered', data: sent.fact }
    : { type: 'tool_call_failed', data: sent.fact };
}

export async function journalledCall(
  forwarding: Forwarding,
  recording: Recording,
  journalling?: CallJournalling,
  shownBytesOf?: ShownBytesOf,
): Promise<JournalledCall> {
  const number =
    journalling === undefined ? 0 : await journalling.started(await startOf(forwarding, recording, journalling));
  if (number === undefined) {
    return unsent;
  }
  const once = await forwardedOnce(forwarding, recording);
  const settled = await settledOf(once, recording, shownBytesOf?.(once));
  await journalling?.ended(number, endedOf(settled));
  return settled;
}

function replied(state: RunState, sent: SentCall, replying: Replying, room: number | undefined): CallReply {
  const failure = failureCounted(state.tally(), sent.done, replying);
  state.tallied(failure.tally);
  if (failure.value !== undefined) {
    state.ended(failure.value);
  }
  const reply = callReplyOf(replyOf(sent.done, replying, room), sent.done, sent.fact.duration_ms);
  if (!sent.answered) {
    return reply;
  }
  state.answered(sent.fact.result_bytes);
  return { ...reply, scrubbedResult: sent.done.scrubbed };
}

export interface SentReply {
  readonly ended: CallEnded;
  readonly reply: ToolReply;
}

export interface ToolSending {
  readonly start: (request: ToolCallRequest) => Promise<CallStarted>;
  readonly send: (request: ToolCallRequest, signal: Readonly<AbortSignal>) => Promise<SentReply>;
}

function replyingOf({ context, secrets, report }: RunToolsParts, { reference }: NamedOffer): Replying {
  return { server: reference.server, meta: context.meta, scrub: secrets.scrub, report };
}

export function sending(parts: RunToolsParts, offered: NamedOffer): ToolSending {
  const { slot } = offered;
  const tool = offered.tool.name;
  const recording = recordingOf(slot.settings, parts.secrets, parts.keep);
  const replying = replyingOf(parts, offered);
  const readOnly = isReadOnly(offered.tool.annotations);
  return {
    start: ({ callId, input }) => startOf({ slot, tool, input }, recording, { callId, readOnly }),
    send: async ({ input, room }, signal) => {
      const forwarding = { slot, tool, input, meta: parts.context.meta, signal, ...parts.timing };
      const once = await forwardedOnce(forwarding, recording);
      const { text, isError, shownBytes } = replyOf(once.done, replying, room);
      const settled = await settledOf(once, recording, shownBytes);
      reportedFailure(once.done, replying);
      return { ended: endedOf(settled), reply: { text, isError } };
    },
  };
}

export function caller(
  parts: RunToolsParts,
  state: RunState,
  offered: NamedOffer,
): (request: ToolCallRequest, signals: CallSignals) => Promise<CallReply> {
  const { slot } = offered;
  const { context, timing } = parts;
  const recording = recordingOf(slot.settings, parts.secrets, parts.keep);
  const replying = replyingOf(parts, offered);
  return async ({ callId, input, room }, signals) => {
    if (signals.signal.aborted) {
      return notSent;
    }
    const admitted = admission(state.tally(), { tool: offered.name, callId, input });
    state.tallied(admitted.tally);
    if (!admitted.admitted) {
      return unsentReply(admitted.refusal);
    }
    const forwarding = { slot, tool: offered.tool.name, input, meta: context.meta, signal: signals.signal };
    const journalling: CallJournalling = {
      callId,
      readOnly: isReadOnly(offered.tool.annotations),
      started: async (fact) => {
        const number = await parts.run(context.journal.started(fact));
        if (number !== undefined) {
          state.used(offered);
        }
        return number;
      },
      ended: async (number, fact) => {
        if (!signals.cancelled.aborted) {
          await parts.run(context.journal.ended(number, fact));
        }
      },
    };
    const journey = await journalledCall(
      { ...forwarding, ...timing },
      recording,
      journalling,
      (sent) => replyOf(sent.done, replying, room).shownBytes,
    );
    return journey.sent ? replied(state, journey, replying, room) : notRecorded;
  };
}

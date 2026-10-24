import type { ServerMessage } from '../access/caller-context.ts';
import type { CallsEndedBecause } from '../access/tool-server-failed.ts';
import {
  countsAgainstTheRun,
  failedOnce,
  failingBecause,
  failuresEnded,
  shownResult,
  type CallTally,
} from '../bounds/call-bounds.ts';
import { bytesOf } from '../bounds/text-bytes.ts';
import { errorTextForModel, errorTextForOperator, resultText, type ToolAnswer } from '../bounds/tool-results.ts';
import { runIdKey, callIdKey } from './call-meta.ts';
import type { Delivered, Forwarded, ForwardedOutcome } from './tool-calls.ts';

export interface ToolReply {
  readonly text: string;
  readonly isError: boolean;
}

interface ModelWords extends ToolReply {
  readonly shownBytes?: number;
}

export type ReplyOutcome =
  | 'result'
  | 'tool_error'
  | 'server_failure'
  | 'timed_out'
  | 'cancelled'
  | 'too_large'
  | 'not_sent';

export interface CallReply extends ModelWords {
  readonly outcome: ReplyOutcome;
  readonly resultBytes: number | null;
  readonly durationMs: number;
  readonly serverRequestId: string | null;
  readonly scrubbedResult?: ToolAnswer;
}

export interface Replying {
  readonly server: string;
  readonly meta: Readonly<Record<string, string>>;
  readonly scrub: (text: string) => string;
  readonly report: (message: ServerMessage) => void;
}

export interface Tallied<A> {
  readonly tally: CallTally;
  readonly value: A;
}

export function reportedFailure(done: Forwarded, replying: Replying): boolean {
  if (!countsAgainstTheRun(done.outcome)) {
    return false;
  }
  replying.report({
    server: replying.server,
    message: errorTextForOperator(done.message, replying.scrub),
    run_id: replying.meta[runIdKey] ?? null,
    call_id: replying.meta[callIdKey] ?? null,
  });
  return true;
}

export function failureCounted(
  tally: CallTally,
  done: Forwarded,
  replying: Replying,
): Tallied<CallsEndedBecause | undefined> {
  if (!reportedFailure(done, replying)) {
    return { tally, value: undefined };
  }
  const counted = failedOnce(tally);
  const because = failingBecause(done.failure === 'rate_limited');
  return { tally: counted, value: failuresEnded(counted) ? because : undefined };
}

export function serverFailedText(server: string, said: string): string {
  return `The tool server ${server} failed: ${said}`;
}

export function replyOf(done: Delivered, replying: Pick<Replying, 'server' | 'scrub'>, room?: number): ModelWords {
  if (done.resultJson === null) {
    const said = errorTextForModel(done.message, replying.scrub);
    const text =
      done.outcome === 'arguments_refused' || done.outcome === 'too_large'
        ? said
        : serverFailedText(replying.server, said);
    return { text, isError: true };
  }
  return { ...shownResult(resultText(done.scrubbed), room), isError: done.outcome === 'tool_error' };
}

function replyOutcomeOf(outcome: ForwardedOutcome): ReplyOutcome {
  return outcome === 'arguments_refused' ? 'tool_error' : outcome;
}

export function callReplyOf(words: ModelWords, done: Delivered, durationMs: number): CallReply {
  return {
    ...words,
    outcome: replyOutcomeOf(done.outcome),
    resultBytes: 'keptJson' in done ? bytesOf(done.keptJson) : null,
    durationMs,
    serverRequestId: done.serverRequestId,
  };
}

export function unsentReply(text: string): CallReply {
  return { text, isError: true, outcome: 'not_sent', resultBytes: null, durationMs: 0, serverRequestId: null };
}

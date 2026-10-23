import { Effect, Predicate, type Schema } from 'effect';

import type { NotOfferedBecause, ToolNotOffered } from '../access/tool-not-offered.ts';
import type { ToolServerFailed, ServerFailedBecause } from '../access/tool-server-failed.ts';
import { cutToFailureBound } from '../bounds/call-bounds.ts';
import { resultText, type AnswerBlock, type ToolAnnotations } from '../bounds/tool-results.ts';
import type { CallAnswered, CallFailed, SentCallFailedBecause } from '../calls/call-facts.ts';
import type { SentCall } from '../calls/tool-caller.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { refusalOf, type Unusable } from '../org-servers/server-refusals.ts';
import { answeredEnding, refusedEnding, traced, type TracedServer } from './traced-calls.ts';

export interface CallAnswer {
  readonly content: readonly AnswerBlock[];
  readonly structuredContent?: Schema.Json;
}

interface AnsweredCall {
  readonly kind: 'answered';
  readonly detail: string;
  readonly retryAfterMs: number | null;
  readonly annotations: ToolAnnotations | undefined;
}

export type AnsweredOnce =
  | (AnsweredCall & {
      readonly outcome: 'result';
      readonly answer: CallAnswer;
      readonly answered: CallAnswered;
    })
  | (AnsweredCall & { readonly outcome: 'tool_error'; readonly answered: CallAnswered })
  | (AnsweredCall & { readonly outcome: SentCallFailedBecause; readonly failed: CallFailed });

interface Unopened<Refused extends string, Because extends string> {
  readonly kind: 'unopened';
  readonly refused: Refused;
  readonly because: Because;
  readonly detail: string;
}

export type UnopenedOnce =
  | Unopened<'tool_not_offered', NotOfferedBecause>
  | Unopened<'tool_server_failed', ServerFailedBecause>;

export type CalledOnce = UnopenedOnce | AnsweredOnce;

type Refusal<Refused extends ToolNotOffered | ToolServerFailed> = Pick<Refused, 'because' | 'detail'>;

export function notOfferedOnce({ because, detail }: Refusal<ToolNotOffered>): UnopenedOnce {
  return { kind: 'unopened', refused: 'tool_not_offered', because, detail };
}

function failedToOpenOnce({ because, detail }: Refusal<ToolServerFailed>): UnopenedOnce {
  return { kind: 'unopened', refused: 'tool_server_failed', because, detail: cutToFailureBound(detail) };
}

export function refusedOnce(unusable: Unusable): UnopenedOnce {
  const refusal = refusalOf(unusable);
  return Predicate.isTagged(refusal, 'tool_not_offered') ? notOfferedOnce(refusal) : failedToOpenOnce(refusal);
}

export function answeredOnce(
  sent: SentCall,
  scrub: (text: string) => string,
  annotations: ToolAnnotations | undefined,
): AnsweredOnce {
  const answered = { kind: 'answered', annotations, retryAfterMs: sent.done.retryAfterMs } as const;
  if (!sent.answered) {
    const { done, fact } = sent;
    return { ...answered, outcome: done.outcome, failed: fact, detail: cutToFailureBound(scrub(done.message)) };
  }
  const { done, fact } = sent;
  return done.outcome === 'result'
    ? { ...answered, outcome: done.outcome, answer: done.scrubbed, answered: fact, detail: '' }
    : { ...answered, outcome: done.outcome, answered: fact, detail: cutToFailureBound(resultText(done.scrubbed)) };
}

function endingOf(once: CalledOnce): Readonly<Record<string, string>> {
  return once.kind === 'unopened' ? refusedEnding(once.refused, once.because) : answeredEnding(once.outcome);
}

export function tracedOnce(
  reference: ToolReference,
  server: TracedServer,
  calling: Effect.Effect<CalledOnce>,
): Effect.Effect<CalledOnce> {
  return traced(reference, server, (endCall) => calling.pipe(Effect.tap((once) => endCall(endingOf(once)))));
}

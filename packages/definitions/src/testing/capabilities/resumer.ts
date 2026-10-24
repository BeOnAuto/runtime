import { Effect } from 'effect';

import {
  defineCapability,
  numberingAfter,
  numberingFrom,
  outputInWords,
  type CallFact,
  type CallEnd,
  type CancelledAttempt,
  type Capability,
  type RunAttempt,
  type RunContext,
} from '../../index.ts';
import { modelCallSent } from '../../journal-testing/model-calls.ts';
import { startOfCall } from './tool-user.ts';

export const quietMs = 60_000;

export interface ResumerOptions {
  readonly beforeItsCall?: Effect.Effect<void>;
  readonly afterItsCall?: Effect.Effect<void>;
  readonly whenRefused?: Effect.Effect<void>;
  readonly whenCancelled?: 'stop' | 'finish';
  readonly startsAToolCall?: boolean;
  readonly beforeItsEnds?: (attempt: RunAttempt) => RunAttempt;
}

export interface Resumer {
  readonly capability: Capability;
  readonly contexts: () => readonly RunContext[];
}

function nextModelCallOf({ journal }: RunContext): number {
  const { modelCallsBefore, calls } = journal.attempt;
  return modelCallsBefore + 1 + calls.filter(({ type }) => type === 'model_call_started').length;
}

function nextToolCallOf({ journal }: RunContext): number {
  return 1 + journal.attempt.calls.filter(({ type }) => type === 'tool_call_started').length;
}

function callOf(context: RunContext, startsAToolCall: boolean): CallFact {
  if (startsAToolCall) {
    const number = nextToolCallOf(context);
    return { type: 'tool_call_started', data: { ...startOfCall(number), number } };
  }
  return { type: 'model_call_started', data: { number: nextModelCallOf(context), ...modelCallSent() } };
}

function answeredIn({ calls }: RunAttempt): number {
  return calls.filter(({ type }) => type === 'model_call_answered').length;
}

function cancelledAt(attempt: RunAttempt): CancelledAttempt {
  const { openModelCalls, openCalls } = attempt.calls.reduce(
    (numbering, call) => numberingAfter(numbering, call),
    numberingFrom(0, attempt.modelCallsBefore),
  );
  const interrupted = { because: 'interrupted' as const, duration_ms: 0 };
  return {
    ends: [
      ...[...openModelCalls].map((number): CallEnd => ({
        type: 'model_call_failed',
        data: { number, ...interrupted, provider: 'anthropic', detail: 'Cancelled while the model answered' },
      })),
      ...[...openCalls].map((number): CallEnd => ({
        type: 'tool_call_failed',
        data: { number, ...interrupted, jsonrpc_id: null },
      })),
    ],
    record: { answered: answeredIn(attempt) },
  };
}

export function resumer({
  beforeItsCall = Effect.void,
  afterItsCall = Effect.void,
  whenRefused = Effect.void,
  whenCancelled = 'stop',
  startsAToolCall = false,
  beforeItsEnds = (attempt) => attempt,
}: ResumerOptions = {}): Resumer {
  const contexts: RunContext[] = [];
  return {
    capability: defineCapability({
      type: 'resumer',
      title: 'Resumer',
      guide: { name: 'resumer' },
      noun: { one: 'resumer', other: 'resumers' },
      describeOutput: outputInWords('result'),
      mediaType: 'text/plain',
      parse: (source: string) => Effect.succeed({ source }),
      summarize: () => ({}),
      callsTools: () => true,
      resumes: {
        afterMs: () => quietMs,
        cancelledAttempt: (_parsed, attempt) => cancelledAt(beforeItsEnds(attempt)),
      },
      whenCancelled,
      run: ({ source }, _input, context) =>
        Effect.gen(function* () {
          contexts.push(context);
          yield* beforeItsCall;
          yield* context.journal.record(callOf(context, startsAToolCall)).pipe(Effect.tapError(() => whenRefused));
          yield* afterItsCall;
          return { output: { source, calls: context.journal.attempt.calls.length }, record: {} };
        }),
    }),
    contexts: () => [...contexts],
  };
}

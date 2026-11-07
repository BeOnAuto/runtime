import { ContextSchema, type Context, type Decider, type ProjectedMessage } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';

const RecordedFactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

export type RecordedFact = typeof RecordedFactSchema.Type;

const verbatim: Decider<null, RecordedFact, RecordedFact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: RecordedFactSchema,
};

export async function recorded(ledger: MemoryLedger, stream: string, facts: readonly RecordedFact[]): Promise<void> {
  await Effect.runPromise(
    Effect.forEach(facts, (fact) => ledger.service.execute(stream, verbatim, fact), { discard: true }),
  );
}

export function messageOf({ type, data, context }: RecordedFact): ProjectedMessage {
  return { id: 'm1', position: 1, type, data, context };
}

export interface RunOf {
  readonly runId: string;
  readonly type: string;
  readonly name: string;
  readonly version: number;
  readonly calledBy?: Context['calledBy'];
  readonly trigger?: Context['trigger'];
}

function runContext(run: RunOf, at: string): Context {
  const { runId, type, name, version, calledBy, trigger } = run;
  return {
    at,
    by: 'playbook:finance',
    runId,
    definitionType: type,
    definitionName: name,
    definitionVersion: version,
    ...(calledBy === undefined ? {} : { calledBy }),
    ...(trigger === undefined ? {} : { trigger }),
  };
}

export function runStarted(run: RunOf, at: string, by: string, outputShape?: string): RecordedFact {
  return {
    type: 'run_started',
    data: {
      input: {},
      started_by: { id: by, name: by },
      ...(outputShape === undefined ? {} : { output_shape: outputShape }),
    },
    context: runContext(run, at),
  };
}

export function runSucceeded(run: RunOf, at: string): RecordedFact {
  return { type: 'run_succeeded', data: { output: { done: true }, record: {} }, context: runContext(run, at) };
}

export function runFailed(run: RunOf, at: string): RecordedFact {
  return { type: 'run_failed', data: {}, context: runContext(run, at) };
}

export function runRejected(run: RunOf, at: string, reason: string, detail: string): RecordedFact {
  const kinds: Readonly<Record<string, string>> = { cancelled: 'requested', unanswered: 'expired' };
  const kind = kinds[reason];
  return {
    type: 'run_rejected',
    data: { rejection: { reason, detail, ...(kind === undefined ? {} : { kind }) } },
    context: runContext(run, at),
  };
}

export interface Asked {
  readonly to: string;
  readonly message: string;
  readonly expiresAt: string;
  readonly answerSchema?: Schema.JsonObject;
  readonly signIn?: Schema.JsonObject;
}

export function runDeferred(run: RunOf, at: string, asked: Asked): RecordedFact {
  const { to, message, expiresAt, answerSchema, signIn } = asked;
  return {
    type: 'run_deferred',
    data: {
      record: {
        to,
        message,
        expires_at: expiresAt,
        requested_at: at,
        ...(answerSchema === undefined ? {} : { answer_schema: answerSchema }),
        ...(signIn === undefined ? {} : { sign_in: signIn }),
      },
    },
    context: runContext(run, at),
  };
}

export function requestAnswered(run: RunOf, at: string, by: string): RecordedFact {
  return {
    type: 'request_answered',
    data: { answer: true, answered_by: { id: by, name: by } },
    context: { ...runContext(run, at), by },
  };
}

export interface DefinitionOf {
  readonly type: string;
  readonly name: string;
  readonly version: number;
}

function definitionContext({ type, name, version }: DefinitionOf, at: string, by: string): Context {
  return { at, by, definitionType: type, definitionName: name, definitionVersion: version };
}

export function definitionCreated(definition: DefinitionOf, at: string, by: string): RecordedFact {
  return {
    type: 'definition_created',
    data: { content: { source: 'source' }, created_by: { id: by, name: by } },
    context: definitionContext(definition, at, by),
  };
}

export function definitionUpdated(definition: DefinitionOf, at: string, by: string): RecordedFact {
  return {
    type: 'definition_updated',
    data: { content: { source: 'source' } },
    context: definitionContext(definition, at, by),
  };
}

export function definitionRetired(definition: DefinitionOf, at: string, by: string): RecordedFact {
  return { type: 'definition_retired', data: {}, context: definitionContext(definition, at, by) };
}

import type { CallerIdentity, CallLink, Conflict, RunCancelled, TriggerLink } from '@on.auto/operations';
import type { CallEnded, CallStarted } from '@on.auto/tool-servers';
import type { Effect, Schema } from 'effect';

import type { CallFact } from '../runs/run-commands.ts';
import type { RecordedCall } from '../runs/run-events.ts';
import type { RecordedAnswer } from '../runs/run-state.ts';

export interface WaitedRequest {
  readonly record: Schema.JsonObject;
  readonly at: string;
  readonly answer: RecordedAnswer | null;
}

export interface RunAttempt {
  readonly startedAt: string;
  readonly modelCallsBefore: number;
  readonly calls: readonly RecordedCall[];
  readonly waitedMs?: number;
  readonly requests?: number;
  readonly request?: WaitedRequest;
}

export type JournalRefusal = Conflict | RunCancelled;

export interface RunJournal {
  readonly attempt: RunAttempt;
  readonly started: (fact: CallStarted) => Effect.Effect<number | undefined>;
  readonly ended: (number: number, fact: CallEnded) => Effect.Effect<boolean>;
  readonly record: (fact: CallFact) => Effect.Effect<number, JournalRefusal>;
}

export interface RunLineage {
  readonly startId: string;
  readonly correlationId: string;
}

export interface RunContext {
  readonly id: string;
  readonly org: string;
  readonly playbook: string;
  readonly caller: CallerIdentity;
  readonly definition: { readonly name: string; readonly version: number };
  readonly journal: RunJournal;
  readonly lineage: RunLineage;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy?: CallLink;
  readonly trigger?: TriggerLink;
  readonly actsFor?: string;
  readonly longestRunOf: (type: string, name: string) => Effect.Effect<number | undefined>;
  readonly longestRunFor: (type: string, name: string, input: Schema.Json) => Effect.Effect<number | undefined>;
  readonly resumesAfterOf: (type: string, name: string) => Effect.Effect<number | undefined>;
}

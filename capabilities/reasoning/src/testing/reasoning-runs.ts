import { memoryRecordedContent } from '@on.auto/content/testing';
import type {
  CapabilityAnswer,
  CapabilityRejection,
  RunAttempt,
  RunContext,
  PreparedDefinition,
  Capability,
} from '@on.auto/definitions';
import {
  cancelledAfter,
  noCalledDefinitions,
  recordingJournal,
  type RecordingJournal,
} from '@on.auto/definitions/testing';
import { allPermissions, type CallerIdentity } from '@on.auto/operations';
import { noToolServers } from '@on.auto/tool-servers/testing';
import { DateTime, Effect, type Exit, type Schema } from 'effect';
import { TestClock } from 'effect/testing';

import {
  makeReasoningFunctionAdapter,
  type ReasoningFunctionAdapterOptions,
} from '../capability/reasoning-function.ts';
import type { ModelRequest } from '../model/model-request.ts';
import { scriptedLanguageModel, type ScriptedReply } from './scripted-language-model.ts';

export const moment = '2026-10-01T09:30:00.000Z';

const anthropicOnly = { providers: ['anthropic'], aliases: [] };

type Tools = ReasoningFunctionAdapterOptions['tools'];

type Content = ReasoningFunctionAdapterOptions['content'];

type Defaulted = 'tools' | 'content' | 'offered';

export type ReasoningAdapterGiven = Omit<ReasoningFunctionAdapterOptions, Defaulted> &
  Partial<Pick<ReasoningFunctionAdapterOptions, Defaulted>>;

export function reasoningAdapter({
  tools = noToolServers,
  content = memoryRecordedContent(),
  offered = anthropicOnly,
  ...options
}: ReasoningAdapterGiven): Capability {
  return makeReasoningFunctionAdapter({ ...options, tools, content, offered });
}

export const acmeAdmin: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export function runContextWith(journal: RecordingJournal, caller = acmeAdmin): RunContext {
  return {
    id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    org: 'acme',
    playbook: 'alpha',
    caller,
    definition: { name: 'summary', version: 1 },
    journal,
    lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
    depth: 0,
    callDepth: 0,
    ...noCalledDefinitions,
  };
}

export const firstAttempt: RunAttempt = { startedAt: moment, modelCallsBefore: 0, calls: [] };

export function runContext(): RunContext {
  return runContextWith(recordingJournal());
}

export type Run = Exit.Exit<CapabilityAnswer, CapabilityRejection>;

export interface ReasoningRun {
  readonly capability: Capability;
  readonly content: Content;
  readonly journal: RecordingJournal;
  readonly requests: () => readonly ModelRequest[];
  readonly prepared: (source: string) => PreparedDefinition;
  readonly running: (source: string, input?: Schema.Json) => Promise<Run>;
}

export interface Reasoning {
  readonly tools?: Tools;
  readonly attempt?: RunAttempt;
  readonly content?: Content;
  readonly images?: ReasoningFunctionAdapterOptions['images'];
  readonly admit?: ReasoningFunctionAdapterOptions['languageModel']['admit'];
  readonly cancelledAfter?: number;
  readonly approvals?: ReasoningFunctionAdapterOptions['approvals'];
  readonly caller?: CallerIdentity;
}

export function reasoningOf(
  {
    tools = noToolServers,
    attempt = firstAttempt,
    content = memoryRecordedContent(),
    images,
    admit,
    cancelledAfter: cancelledAt = Number.POSITIVE_INFINITY,
    approvals,
    caller,
  }: Reasoning,
  ...replies: readonly ScriptedReply[]
): ReasoningRun {
  const scripted = scriptedLanguageModel(...replies);
  const journal = cancelledAfter(
    recordingJournal(() => false, attempt),
    cancelledAt,
  );
  const languageModel = admit === undefined ? scripted.languageModel : { ...scripted.languageModel, admit };
  const capability = reasoningAdapter({
    languageModel,
    tools,
    content,
    ...(images === undefined ? {} : { images }),
    ...(approvals === undefined ? {} : { approvals }),
  });
  const prepared = (source: string): PreparedDefinition => Effect.runSync(capability.prepare(source));
  return {
    capability,
    content,
    journal,
    requests: scripted.requests,
    prepared,
    running: (source, input = {}) =>
      Effect.runPromiseExit(
        TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment))).pipe(
          Effect.andThen(prepared(source).run(input, runContextWith(journal, caller))),
          Effect.provide(TestClock.layer()),
        ),
      ),
  };
}

export function reasoningWith(...replies: readonly ScriptedReply[]): ReasoningRun {
  return reasoningOf({}, ...replies);
}

export function reasoningWithTools(tools: Tools, ...replies: readonly ScriptedReply[]): ReasoningRun {
  return reasoningOf({ tools }, ...replies);
}

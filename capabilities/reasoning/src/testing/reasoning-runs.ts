import type {
  CapabilityAnswer,
  CapabilityRejection,
  RunContext,
  PreparedDefinition,
  Capability,
} from '@on.auto/definitions';
import { noLongestRuns, recordingJournal, type RecordingJournal } from '@on.auto/definitions/testing';
import { allPermissions } from '@on.auto/operations';
import type { ToolAccess } from '@on.auto/tool-servers';
import { noToolServers } from '@on.auto/tool-servers/testing';
import { DateTime, Effect, type Exit, type Schema } from 'effect';
import { TestClock } from 'effect/testing';

import {
  makeReasoningFunctionAdapter,
  type ReasoningFunctionAdapterOptions,
} from '../capability/reasoning-function.ts';
import type { ModelRequest } from '../model/model-request.ts';
import { scriptedLanguageModel, type ScriptedReply } from './scripted-language-model.ts';

const moment = '2026-10-01T09:30:00.000Z';

const anthropicOnly = { providers: ['anthropic'], aliases: [] };

export const runContext: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { name: 'summary', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  ...noLongestRuns,
};

export type Run = Exit.Exit<CapabilityAnswer, CapabilityRejection>;

export interface ReasoningRun {
  readonly capability: Capability;
  readonly requests: () => readonly ModelRequest[];
  readonly prepared: (source: string) => PreparedDefinition;
  readonly running: (source: string, input?: Schema.Json) => Promise<Run>;
}

export interface ToolRun extends ReasoningRun {
  readonly journal: RecordingJournal;
}

function reasoningOf(tools: ToolAccess, replies: readonly ScriptedReply[], context: RunContext): ReasoningRun {
  const scripted = scriptedLanguageModel(...replies);
  const capability = makeReasoningFunctionAdapter({
    languageModel: scripted.languageModel,
    offered: anthropicOnly,
    tools,
  });
  const prepared = (source: string): PreparedDefinition => Effect.runSync(capability.prepare(source));
  return {
    capability,
    requests: scripted.requests,
    prepared,
    running: (source, input = {}) =>
      Effect.runPromiseExit(
        TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment))).pipe(
          Effect.andThen(prepared(source).run(input, context)),
          Effect.provide(TestClock.layer()),
        ),
      ),
  };
}

export function adapterWithoutTools({
  languageModel,
  offered,
}: Pick<ReasoningFunctionAdapterOptions, 'languageModel' | 'offered'>): Capability {
  return makeReasoningFunctionAdapter({ languageModel, offered, tools: noToolServers });
}

export function reasoningWith(...replies: readonly ScriptedReply[]): ReasoningRun {
  return reasoningOf(noToolServers, replies, runContext);
}

export function reasoningWithTools(tools: ToolAccess, ...replies: readonly ScriptedReply[]): ToolRun {
  const journal = recordingJournal();
  return { ...reasoningOf(tools, replies, { ...runContext, journal }), journal };
}

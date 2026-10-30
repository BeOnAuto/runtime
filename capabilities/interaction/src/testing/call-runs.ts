import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import {
  noCalledDefinitions,
  onTheStandingClock,
  recordingJournal,
  type RecordingJournal,
} from '@on.auto/definitions/testing';
import { allPermissions } from '@on.auto/operations';
import type { Timing } from '@on.auto/tool-servers';
import { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { reportingAccess } from '@on.auto/tool-servers/testing';
import { Effect, Function, type Exit, type Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { makeInteractionFunctionAdapter } from '../capability/interaction-function.ts';

export const callRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const chatCallKey = 'chat-api-key-5a1c9e27';

const threadInput = { channel: 'C0123', thread: '1728379900.000050' };

export interface CallRunOptions {
  readonly server?: FakeMcpOptions;
  readonly entry?: Readonly<Record<string, unknown>>;
  readonly timing?: Timing;
  readonly journal?: RecordingJournal;
}

export interface CallRuns {
  readonly fake: FakeMcpServer;
  readonly journal: RecordingJournal;
  readonly run: (source: string, input?: Schema.Json) => Promise<Exit.Exit<CapabilityAnswer, CapabilityRejection>>;
}

function contextOf(journal: RecordingJournal): RunContext {
  return {
    id: callRunId,
    org: 'acme',
    playbook: 'alpha',
    caller: { id: 'acme-admin', name: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
    definition: { name: 'thread-replies', version: 1 },
    journal,
    lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: callRunId },
    depth: 0,
    callDepth: 0,
    ...noCalledDefinitions,
  };
}

export async function callRuns(options: CallRunOptions = {}): Promise<CallRuns> {
  const fake = await serveFakeMcp({ bearer: chatCallKey, data: true, ...options.server });
  onTestFinished(fake.close);
  const chat = { url: fake.url, headers: { Authorization: 'Bearer ${CHAT_KEY}' }, org: 'acme', ...options.entry };
  const { access } = reportingAccess(
    { chat },
    { environment: { CHAT_KEY: chatCallKey }, ...(options.timing === undefined ? {} : { timing: options.timing }) },
  );
  onTestFinished(access.close);
  const capability = makeInteractionFunctionAdapter({
    tools: access,
    openRequests: Function.constant(Effect.succeed(0)),
    mostOpenRequests: 10,
  });
  const journal = options.journal ?? recordingJournal();
  const context = contextOf(journal);
  return {
    fake,
    journal,
    run: (source, input = threadInput) =>
      Effect.runPromiseExit(
        onTheStandingClock(Effect.flatMap(capability.prepare(source), (prepared) => prepared.run(input, context))),
      ),
  };
}

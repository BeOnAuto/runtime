import type { RecordedCall, RunAttempt } from '@on.auto/definitions';
import type { FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { fakeMcpInProcess, reportingAccess, type AccessOptions } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import { documentOf } from './definition-documents.ts';
import { firstAttempt, reasoningOf, type Reasoning } from './reasoning-runs.ts';
import type { ScriptedReply } from './scripted-language-model.ts';

export const graphKey = 'graph-api-key-4f1d9a7c2b';

export const withGraphTools = documentOf('model: anthropic/claude-sonnet-4-5\ntools: [graph/*]', 'Summarize acme.');

export const withoutTools = documentOf('model: anthropic/claude-sonnet-4-5', 'Summarize acme.');

export function aGraph(): FakeMcpServer {
  const fake = fakeMcpInProcess({ bearer: graphKey });
  onTestFinished(() => fake.close());
  return fake;
}

export function graphAccessTo(
  url: string,
  entry: Readonly<Record<string, unknown>> = {},
  fetch?: AccessOptions['fetch'],
) {
  const { access } = reportingAccess(
    { graph: { url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry } },
    { environment: { GRAPH_API_KEY: graphKey }, ...(fetch === undefined ? {} : { fetch }) },
  );
  onTestFinished(() => access.close());
  return access;
}

export function attemptOf(calls: readonly RecordedCall[]): RunAttempt {
  return { ...firstAttempt, calls };
}

export function upToTheFirst(calls: readonly RecordedCall[], type: RecordedCall['type']): readonly RecordedCall[] {
  return calls.slice(0, calls.findIndex((call) => call.type === type) + 1);
}

export const stopping: ScriptedReply = () => Effect.die(new Error('The server stopped'));

export async function recordedBy(source: string, reasoning: Reasoning, ...replies: readonly ScriptedReply[]) {
  const first = reasoningOf(reasoning, ...replies);
  const ran = await first.running(source);
  return { first, ran, calls: first.journal.calls() };
}

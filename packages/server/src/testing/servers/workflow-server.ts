import type { McpSession, ToolResult } from '@on.auto/api/testing';
import type { ScriptedReplies } from '@on.auto/reasoning/testing';
import type { HostClock } from '@on.auto/workflow-host';
import { Option, Schema } from 'effect';

import type { ProgramPoolOf } from '../../composition/served-computation.ts';
import { until } from '../waiting/until.ts';
import { type RequestOptions, type TestResponse } from './http-client.ts';
import { servingReasoning, type ReasoningServer } from './reasoning-server.ts';

const statusOf = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }));

const runOf = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

export function servingWorkflows(
  replies: readonly ScriptedReplies[],
  environment: Readonly<Record<string, string>> = {},
  programPoolOf?: ProgramPoolOf,
  clock?: HostClock,
): Promise<ReasoningServer> {
  return servingReasoning(replies, environment, undefined, {
    ...(programPoolOf === undefined ? {} : { programPoolOf }),
    ...(clock === undefined ? {} : { clock }),
  });
}

export function workflowSource(name: string, steps: string): string {
  return `document:\n  dsl: '1.0.3'\n  namespace: acme\n  name: ${name}\n  version: '1.0.0'\n${steps}`;
}

export function runIdIn(body: unknown): string {
  return runOf(body).run_id;
}

export function isStarted(body: unknown): boolean {
  return Option.getOrUndefined(statusOf(body))?.status === 'started';
}

export function settledRun(server: ReasoningServer, path: string, options: RequestOptions = {}): Promise<TestResponse> {
  return until(
    () => server.call('GET', path, options),
    (response) => !isStarted(response.body),
  );
}

export function settledOverMcp(session: McpSession, runId: string): Promise<ToolResult> {
  return until(
    () => session.callTool('get_run', { run_id: runId }),
    (reading) => !isStarted(reading.structuredContent),
  );
}

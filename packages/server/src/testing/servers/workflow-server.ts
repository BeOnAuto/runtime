import type { McpSession, ToolResult } from '@on.auto/api/testing';
import type { ScriptedReplies } from '@on.auto/reasoning/testing';
import { Option, Schema } from 'effect';

import type { ProgramPoolOf } from '../../composition/served-computation.ts';
import { fewSweeps, type SteppedServerClock } from '../waiting/stepped-server-clock.ts';
import { whenHeld } from '../waiting/until.ts';
import { type RequestOptions, type TestResponse } from './http-client.ts';
import { servingReasoning, type ReasoningServer } from './reasoning-server.ts';
import type { ServedParts } from './served-parts.ts';

export {
  heldAnswerOn,
  steppedServerClock,
  testServersStartAt,
  whenSwept,
  type SteppedServerClock,
} from '../waiting/stepped-server-clock.ts';
export { whenHeld } from '../waiting/until.ts';
export { contributing, createdWithGoals, givenGoals, servingReasoningWithGoals } from '../settings/goals-kept.ts';

const statusOf = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.String }));

const runOf = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

export function servingWorkflows(
  replies: readonly ScriptedReplies[],
  environment: Readonly<Record<string, string>> = {},
  programPoolOf?: ProgramPoolOf,
  clock?: NonNullable<ServedParts['clock']>,
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

/**
 * The run once it ended. On the server's own stepped clock its sweeps are stepped, a few at most, while it is at rest
 * and the run has not ended; on a clock its test moves, or the system's, the wait is told as the server works.
 */
export function settledRun(server: ReasoningServer, path: string, options: RequestOptions = {}): Promise<TestResponse> {
  if (server.clock !== undefined) {
    return settledAsSwept(server, server.clock, path, options);
  }
  return whenHeld(
    () => server.call('GET', path, options),
    (response) => !isStarted(response.body),
  );
}

/** The run once it ended, the server's sweeps stepped while it is at rest and the run has not. */
export function settledAsSwept(
  server: Pick<ReasoningServer, 'call'>,
  clock: Pick<SteppedServerClock, 'swept'>,
  path: string,
  options: RequestOptions = {},
): Promise<TestResponse> {
  return clock.swept.until(
    () => server.call('GET', path, options),
    (response) => !isStarted(response.body),
    fewSweeps,
  );
}

export function settledOverMcp(session: McpSession, runId: string): Promise<ToolResult> {
  return whenHeld(
    () => session.callTool('get_run', { run_id: runId }),
    (reading) => !isStarted(reading.structuredContent),
  );
}

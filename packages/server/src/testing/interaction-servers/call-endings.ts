import type { CallOptions } from '@on.auto/interaction/testing';
import { patientTiming } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { expect } from 'vitest';

import type { TestResponse } from '../servers/http-client.ts';
import { askingASystem, type CallingType, type SystemOptions, type SystemServer } from './system-calls.ts';

export const quickCalls = { ...patientTiming, callMs: 300 };

export const quickOpening = { ...patientTiming, openMs: 300 };

export const someDetail: unknown = expect.any(String);

export const mayChange = { readOnlyHint: false };

export const reads = { readOnlyHint: true };

export const problems = 'https://on.auto/problems/';

export const mayHaveActed = '. The tool ran and may have changed something; a run again calls it again';

export const refusingTheArguments: unknown = expect.stringMatching(
  /^The strict tool of chat refused the arguments: .*limit must be a whole number/u,
);

export const failedAfterCalling = (tool: string): unknown =>
  expect.stringMatching(
    new RegExp(`^The tool server chat failed: .*, after the run called the ${tool} tool of chat$`, 'u'),
  );

export const notAnsweredInTime: unknown = expect.stringMatching(
  /^The tool server chat failed: .*did not answer within 300 ms.*, after the run called the sleep tool of chat$/u,
);

export interface Ending {
  readonly status: number;
  readonly type: string;
  readonly kind?: string;
  readonly because?: string;
  readonly detail: unknown;
  readonly retryAfter: string | null;
}

export interface Row {
  readonly server?: SystemOptions;
  readonly document?: CallOptions;
  readonly input?: unknown;
  readonly before?: (server: SystemServer) => Promise<void> | void;
}

export type Rows = ReadonlyArray<readonly [string, Row, Ending]>;

const decodeProblem = Schema.decodeUnknownSync(
  Schema.Struct({
    type: Schema.String,
    kind: Schema.optionalKey(Schema.String),
    because: Schema.optionalKey(Schema.String),
    detail: Schema.Unknown,
  }),
);

export function endingOf({ status, body, headers }: TestResponse): Ending {
  return { status, ...decodeProblem(body), retryAfter: headers.get('retry-after') };
}

export async function endedFor(type: CallingType, { server = {}, document = {}, input, before }: Row): Promise<Ending> {
  const asking = await askingASystem({ timing: patientTiming, ...server, type });
  await asking.define('asking', document);
  await before?.(asking);
  return endingOf(await asking.runCall('asking', input));
}

export const sentNothing = (because: string, detail: unknown, kind = 'tool_not_offered'): Ending => ({
  status: 503,
  type: `${problems}unavailable`,
  kind,
  because,
  detail,
  retryAfter: kind === 'tool_not_offered' ? null : '5',
});

export const unworkable = (detail: unknown): Ending => ({
  status: 409,
  type: `${problems}conflict`,
  kind: 'unworkable',
  detail,
  retryAfter: null,
});

export const unfinished = (because: string, detail: unknown): Ending => ({
  status: 503,
  type: `${problems}tools_unfinished`,
  kind: 'tools_unfinished',
  because,
  detail,
  retryAfter: null,
});

export const unknown = (because: string, detail: unknown): Ending => ({
  status: 409,
  type: `${problems}effect_unknown`,
  kind: 'effect_unknown',
  because,
  detail,
  retryAfter: null,
});

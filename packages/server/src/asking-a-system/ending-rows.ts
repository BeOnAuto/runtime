import type { CallOptions } from '@on.auto/interaction/testing';
import { patientTiming } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { expect } from 'vitest';

import {
  askingASystem,
  calling,
  openInput,
  type SystemOptions,
  type SystemServer,
} from '../testing/interaction-servers/system-calls.ts';
import type { TestResponse } from '../testing/servers/http-client.ts';

export const quickCalls = { ...patientTiming, callMs: 300 };

const quickOpening = { ...patientTiming, openMs: 300 };

const someDetail: unknown = expect.any(String);

export const mayChange = { readOnlyHint: false };

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

export async function endedFor({ server = {}, document = {}, input, before }: Row): Promise<Ending> {
  const asking = await askingASystem({ timing: patientTiming, ...server });
  await asking.define('asking', document);
  await before?.(asking);
  return endingOf(await asking.runCall('asking', input));
}

const sentNothing = (because: string, detail: unknown, kind = 'tool_not_offered'): Ending => ({
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

export const beforeAnything: ReadonlyArray<readonly [string, Row, Ending]> = [
  [
    'an input that does not match',
    { input: { channel: 7 } },
    { status: 422, type: `${problems}invalid_input`, kind: 'input_schema', detail: someDetail, retryAfter: null },
  ],
  [
    'an argument that reads what the input lacks',
    { document: { input: openInput }, input: { channel: 'C0123' } },
    {
      status: 422,
      type: `${problems}invalid_input`,
      detail: 'The definition reads input.thread on line 1, which the input does not have',
      retryAfter: null,
    },
  ],
  [
    'a render a filter stopped',
    { document: { with: ["    channel: '{{ input.channel | divided_by: 0 }}'"] } },
    {
      status: 422,
      type: `${problems}invalid_input`,
      detail: 'The argument channel of the call cannot be rendered with this input',
      retryAfter: null,
    },
  ],
  [
    'an argument that renders a structure among text',
    { document: { with: ["    channel: 'In {{ input.channel }}'"], input: openInput }, input: { channel: ['C0123'] } },
    unworkable(
      'The argument channel of the call renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
    ),
  ],
  [
    'arguments past 16 KiB',
    {
      document: { with: ["    a: '{{ input.a }}'", "    b: '{{ input.b }}'"], input: openInput },
      input: { a: 'x'.repeat(8200), b: 'x'.repeat(8200) },
    },
    unworkable('The arguments of the call take 16415 bytes, more than the 16384 a call may send'),
  ],
  [
    'a server that does not serve the playbook',
    { server: { entry: { playbooks: ['beta'] } } },
    sentNothing('tool_server_not_configured', 'No tool server named chat is configured for this playbook'),
  ],
  [
    'a tool the operator does not allow',
    { server: { entry: { allowed: ['search'] } } },
    sentNothing('tool_not_allowed', 'The operator of this server does not allow chat/thread'),
  ],
  [
    'a server that cannot be reached',
    { before: (server) => server.fake.close() },
    sentNothing('unreachable', expect.stringContaining('could not be reached'), 'tool_server_failed'),
  ],
  [
    'a server that refuses the key at its opening',
    {
      server: {
        entry: { headers: { Authorization: 'Bearer ${STALE_CHAT_KEY}' } },
        environment: { STALE_CHAT_KEY: 'chat-api-key-retired' },
      },
    },
    sentNothing(
      'key_refused',
      'The tool server chat could not be used: The tool server answered HTTP 401',
      'tool_server_failed',
    ),
  ],
  [
    'a listing of the tools the server limits',
    {
      before: (server) => {
        server.fake.answerNextOf('tools/list', 429, 1, { 'retry-after': '120' });
      },
    },
    sentNothing('rate_limited', expect.stringContaining('could not be used'), 'tool_server_failed'),
  ],
  [
    'a listing of the tools that fails',
    {
      before: (server) => {
        server.fake.answerNextOf('tools/list', 500);
      },
    },
    sentNothing('failing', expect.stringContaining('answered HTTP 500'), 'tool_server_failed'),
  ],
  [
    'a listing of the tools that does not answer in time',
    {
      server: { timing: quickOpening },
      before: (server) => {
        server.fake.holdNextOf('tools/list');
      },
    },
    sentNothing(
      'unreachable',
      'The tool server chat could not be used: The tool server did not answer in time',
      'tool_server_failed',
    ),
  ],
  [
    'a tool the server does not list',
    { document: calling('gone') },
    sentNothing('tool_not_listed', 'The tool server chat does not list the tool gone'),
  ],
];

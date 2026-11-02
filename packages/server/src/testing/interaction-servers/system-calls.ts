import { callDocument, type CallOptions } from '@on.auto/interaction/testing';
import { lookupDocument } from '@on.auto/lookup/testing';
import { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { expect, onTestFinished } from 'vitest';

import type { TestResponse } from '../servers/http-client.ts';
import { alpha } from '../servers/reasoning-server.ts';
import type { LedgerOver, ServedParts } from '../servers/served-parts.ts';
import { chatKey } from './chat-deliveries.ts';
import { interactionServerOn, type InteractionServer } from './interaction-server.ts';

type FakeHints = NonNullable<FakeMcpOptions['hints']>;

export type CallingType = 'interaction' | 'lookup';

export const threadInput = { channel: 'C0123', thread: '1728379900.000050' };

export const systemRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const anyOutput: readonly string[] = ['output:', '  schema: {}'];

export const openInput: readonly string[] = ['input:', '  schema: { type: object }'];

export function calling(tool: string, written: readonly string[] = []): CallOptions {
  return { tool, read: null, with: written, input: openInput, output: anyOutput };
}

export function problemWith(fields: Readonly<Record<string, unknown>>): unknown {
  return expect.objectContaining(fields);
}

export interface SystemOptions {
  readonly type?: CallingType;
  readonly hints?: FakeHints;
  readonly entry?: Readonly<Record<string, unknown>>;
  readonly servers?: Readonly<Record<string, unknown>>;
  readonly timing?: ServedParts['toolTiming'];
  readonly ledgerOver?: LedgerOver;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface SystemServer extends InteractionServer {
  readonly type: CallingType;
  readonly fake: FakeMcpServer;
  readonly define: (name: string, document?: CallOptions) => Promise<TestResponse>;
  readonly runCall: (name: string, input?: unknown, runId?: string) => Promise<TestResponse>;
  readonly history: (runId: string) => Promise<readonly HistoryEvent[]>;
}

const HistorySchema = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      type: Schema.String,
      summary: Schema.String,
      data: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
});

export type HistoryEvent = (typeof HistorySchema.Type)['events'][number];

const decodeHistory = Schema.decodeUnknownSync(HistorySchema);

const documentsOf: Readonly<Record<CallingType, (document: CallOptions) => string>> = {
  interaction: callDocument,
  lookup: lookupDocument,
};

export async function askingASystem({
  type = 'interaction',
  hints = {},
  entry = {},
  servers = {},
  timing,
  ledgerOver,
  environment = {},
}: SystemOptions = {}): Promise<SystemServer> {
  const fake = await serveFakeMcp({ bearer: chatKey, data: true, hints });
  onTestFinished(fake.close);
  const chat = { url: fake.url, headers: { Authorization: 'Bearer ${CHAT_KEY}' }, org: 'acme', ...entry };
  const server = await interactionServerOn(
    { CHAT_KEY: chatKey, TOOL_SERVERS: JSON.stringify({ chat, ...servers }), ...environment },
    { ...(timing === undefined ? {} : { toolTiming: timing }), ...(ledgerOver === undefined ? {} : { ledgerOver }) },
  );
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return {
    ...server,
    type,
    fake,
    define: (name, document = {}) =>
      server.call('POST', `${alpha}/definitions/${type}`, {
        body: { name, source: documentsOf[type](document), diagram: 'none' },
      }),
    runCall: (name, input = threadInput, runId = systemRunId) =>
      server.call('POST', `${alpha}/definitions/${type}/${name}/run`, { body: { input, run_id: runId } }),
    history: async (runId) => decodeHistory((await server.call('GET', `${alpha}/runs/${runId}/history`)).body).events,
  };
}

export function lookingUp(options: Omit<SystemOptions, 'type'> = {}): Promise<SystemServer> {
  return askingASystem({ ...options, type: 'lookup' });
}

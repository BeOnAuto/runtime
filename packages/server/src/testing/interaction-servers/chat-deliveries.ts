import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { alpha } from '../servers/reasoning-server.ts';
import type { InteractionServer } from './interaction-server.ts';

export const chatKey = 'chat-api-key-5a1c9e27';

export async function chatServer(echoes?: string): Promise<FakeMcpServer> {
  const chat = await serveFakeMcp({ bearer: chatKey, chat: true, ...(echoes === undefined ? {} : { echoes }) });
  onTestFinished(chat.close);
  return chat;
}

export function chatEnvironment(
  url: string,
  entry: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, string>> {
  return {
    CHAT_KEY: chatKey,
    TOOL_SERVERS: JSON.stringify({
      chat: { url, headers: { Authorization: 'Bearer ${CHAT_KEY}' }, org: 'acme', ...entry },
    }),
  };
}

const HistorySchema = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({ id: Schema.String, type: Schema.String, data: Schema.Record(Schema.String, Schema.Unknown) }),
  ),
});

const decodeHistory = Schema.decodeUnknownSync(HistorySchema);

type DeliveryRow = (typeof HistorySchema.Type)['events'][number];

export async function deliveryRowsOf(server: InteractionServer, runId: string): Promise<readonly DeliveryRow[]> {
  const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
  return decodeHistory(history.body).events.filter(({ type }) => type.startsWith('delivery_'));
}

export async function deliveryHistoryOf(
  server: InteractionServer,
  runId: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  return (await deliveryRowsOf(server, runId)).map(({ type, data }) => Object.assign({ type }, data));
}

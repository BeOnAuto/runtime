import { operatorVariablesOf } from '@on.auto/providers';
import type { OfferedProvider } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { shippedSettings } from '../settings/shipped-settings.ts';
import type { ReasoningServer } from './reasoning-server.ts';

export const connectionsOfAcme = '/v1/orgs/acme/connections';

export const shippedList = shippedSettings.providers;

export const shippedProviders = shippedList.providers;

export const offeredByTheServer: readonly OfferedProvider[] = shippedProviders
  .filter(({ entry }) => operatorVariablesOf(entry).length === 0)
  .map(({ entry }) => ({ name: entry.name, title: entry.title, description: entry.description }));

const AnswerSchema = Schema.Record(Schema.String, Schema.Unknown);

export function answerFieldsOf(body: unknown): readonly string[] {
  return Object.keys(Schema.decodeUnknownSync(AnswerSchema)(body));
}

const AddedSchema = Schema.Struct({ id: Schema.String, connect: Schema.Struct({ url: Schema.String }) });

const LinkSchema = Schema.Struct({ token: Schema.String });

export interface AddedConnection {
  readonly id: string;
  readonly token: string;
}

export function aSecretHeader(name: string, url: string) {
  return {
    name,
    type: 'mcp',
    entry: { url },
    credential: { kind: 'secret', name: 'Authorization', in: 'header' },
  };
}

export function linkIn(answered: unknown): AddedConnection {
  const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(answered);
  const { token } = Schema.decodeUnknownSync(LinkSchema)(Object.fromEntries(new URL(connect.url).searchParams));
  return { id, token };
}

export async function addedConnection(server: Pick<ReasoningServer, 'call'>, body: unknown): Promise<AddedConnection> {
  return linkIn((await server.call('POST', connectionsOfAcme, { body })).body);
}

export async function connectedWith(
  server: Pick<ReasoningServer, 'call'>,
  body: unknown,
  value: string,
): Promise<string> {
  const { id, token } = await addedConnection(server, body);
  await server.call('POST', `${connectionsOfAcme}/${id}/credential`, { body: { token, value } });
  return id;
}

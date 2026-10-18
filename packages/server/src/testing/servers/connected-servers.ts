import { Schema } from 'effect';

import type { ReasoningServer } from './reasoning-server.ts';

export const connectionsOfAcme = '/v1/orgs/acme/connections';

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

export async function addedConnection(server: Pick<ReasoningServer, 'call'>, body: unknown): Promise<AddedConnection> {
  const answer = await server.call('POST', connectionsOfAcme, { body });
  const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(answer.body);
  const { token } = Schema.decodeUnknownSync(LinkSchema)(Object.fromEntries(new URL(connect.url).searchParams));
  return { id, token };
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

import { OrgIdSchema, PlaybookIdSchema } from '@on.auto/operations';
import type { Arrival } from '@on.auto/providers';
import { Option, Schema } from 'effect';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { EventAddress } from './event-ports.ts';

export const eventRoutePath = `${versionPrefix}/orgs/:org/playbooks/:playbook/connections/:connection/events`;

const isOrgId = Schema.is(OrgIdSchema);

const isPlaybookId = Schema.is(PlaybookIdSchema);

const mostConnectionCharacters = 256;

const jsonIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

export function eventAddressIn(c: Context<ApiEnv>): EventAddress | undefined {
  const [org, playbook, connection = ''] = ['org', 'playbook', 'connection'].map((name) => String(c.req.param(name)));
  const wellFormed = isOrgId(org) && isPlaybookId(playbook) && connection.length <= mostConnectionCharacters;
  return wellFormed ? { org, playbook, connection } : undefined;
}

export function eventsAddressAt(publicOrigin: string, { org, playbook, connection }: EventAddress): string {
  const path = ['orgs', org, 'playbooks', playbook, 'connections', connection, 'events'].map((segment) =>
    encodeURIComponent(segment),
  );
  return `${publicOrigin}${versionPrefix}/${path.join('/')}`;
}

export function limitedAs({ org, playbook, connection }: EventAddress): string {
  return `${org}/${playbook}/${connection}`;
}

function textOf(bytes: Readonly<Uint8Array>): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

function bodyIn(bytes: Readonly<Uint8Array>): { readonly body?: Schema.Json } {
  const text = textOf(bytes);
  const body = text === undefined ? Option.none() : jsonIn(text);
  return Option.match(body, { onNone: () => ({}), onSome: (json) => ({ body: json }) });
}

export function arrivalOf(request: Request, bytes: Readonly<Uint8Array>): Arrival {
  return {
    transport: 'request',
    headers: Object.fromEntries(request.headers),
    query: Object.fromEntries([...new URL(request.url).searchParams].toReversed()),
    ...bodyIn(bytes),
  };
}

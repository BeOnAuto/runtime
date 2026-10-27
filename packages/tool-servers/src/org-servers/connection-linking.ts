import type { FetchLike } from '@modelcontextprotocol/client';
import { fetchWithin } from '@on.auto/outbound';
import { Effect, Predicate, Result } from 'effect';

import type { LinkOptions } from '../clients/link-openers.ts';
import { serverLink } from '../clients/server-links.ts';
import type { Describing, LinkedServerSettings } from '../openapi/described-api.ts';
import type { Linking } from './connection-links.ts';
import type { ConnectionServer, ConnectionServerSettings } from './connection-source.ts';
import { serverFailed } from './server-refusals.ts';

export interface ConnectionLinking {
  readonly options: LinkOptions;
  readonly reportLeftOut: Describing['reportLeftOut'];
}

interface Describe {
  readonly server: ConnectionServer;
  readonly fetch: FetchLike;
  readonly linking: ConnectionLinking;
}

type Described = { readonly settings: LinkedServerSettings } | Exclude<Linking, { readonly link: unknown }>;

async function describedConnection(
  settings: ConnectionServerSettings,
  { server, fetch, linking }: Describe,
): Promise<Described> {
  if (settings.type === 'mcp') {
    return { settings };
  }
  const { describedApi } = await import('../openapi/api-description.ts');
  const described = await describedApi(settings, { fetch, reportLeftOut: linking.reportLeftOut });
  if (Result.isFailure(described)) {
    const { failure } = described;
    const message = failure.problems.map(({ detail }) => detail).join('; ');
    const unusable = serverFailed({ settings }, { kind: 'refused', message }, linking.options.secrets);
    return Predicate.isTagged(failure, 'document_unread') ? { unread: unusable } : { refused: unusable };
  }
  const refusal = server.reaches(described.success.api.baseUrl);
  return refusal === undefined
    ? { settings: described.success }
    : { refused: { because: 'connection_not_allowed', detail: refusal } };
}

export async function connectionLinkOf(
  id: string,
  server: ConnectionServer,
  linking: ConnectionLinking,
): Promise<Linking> {
  const fetch = fetchWithin(linking.options.fetch, server.reaches);
  const settings: ConnectionServerSettings = { ...server.settings, connection: id };
  const described = await describedConnection(settings, { server, fetch, linking });
  const refused = () => Effect.runPromise(server.refused);
  return 'settings' in described
    ? { link: serverLink(described.settings, { ...linking.options, fetch }, refused) }
    : described;
}

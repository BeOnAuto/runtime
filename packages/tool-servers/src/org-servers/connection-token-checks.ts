import type { FetchLike } from '@modelcontextprotocol/client';
import { Option, Predicate, Result } from 'effect';

import type { AssertionChecked } from '../assertions/assertion-checks.ts';
import { ignored } from '../clients/ignored.ts';
import type { TokenTarget } from '../clients/token-source.ts';
import type { DocumentRefused } from '../openapi/described-api.ts';
import type { DocumentUnread } from '../openapi/document-reading.ts';
import type { AuthSettings, ClientMintingAuth, OpenApiServerSettings } from '../settings/server-settings.ts';
import type { ConnectionServerSettings } from './connection-source.ts';

type Undescribed = DocumentUnread | DocumentRefused;

export type ConnectionTokensChecked =
  | AssertionChecked
  | { readonly kind: Undescribed['_tag']; readonly problems: Undescribed['problems'] };

export interface ConnectionTokensChecking {
  readonly fetch: FetchLike;
  readonly now: () => number;
}

function mintsWithClientCredentials(auth: AuthSettings | null): auth is ClientMintingAuth {
  return auth !== null && auth.grant !== 'token_exchange' && auth.credential.kind !== 'consent';
}

async function baseUrlOf(
  settings: OpenApiServerSettings,
  fetch: FetchLike,
): Promise<Result.Result<string, Undescribed>> {
  if (settings.base_url !== null) {
    return Result.succeed(settings.base_url);
  }
  const { describedApi } = await import('../openapi/api-description.ts');
  return Result.map(await describedApi(settings, { fetch, reportLeftOut: ignored }), ({ api }) => api.baseUrl);
}

async function targetOf(
  settings: ConnectionServerSettings,
  fetch: FetchLike,
): Promise<Result.Result<TokenTarget, Undescribed>> {
  const { tokenTargetOf } = await import('../clients/link-openers.ts');
  if (settings.type === 'mcp') {
    return Result.succeed(tokenTargetOf(settings));
  }
  return Result.map(await baseUrlOf(settings, fetch), (baseUrl) =>
    tokenTargetOf({ type: 'openapi', api: { baseUrl } }),
  );
}

export async function connectionTokensCheckedOf(
  settings: ConnectionServerSettings,
  { fetch, now }: ConnectionTokensChecking,
): Promise<ConnectionTokensChecked> {
  const auth = Option.getOrThrow(Option.liftPredicate(settings.auth, mintsWithClientCredentials));
  const target = await targetOf(settings, fetch);
  if (Result.isSuccess(target)) {
    const { clientTokensCheckedOf } = await import('../clients/token-source.ts');
    return clientTokensCheckedOf(auth, { ...target.success, fetch, now });
  }
  const { failure } = target;
  const kind = Predicate.isTagged(failure, 'document_unread') ? 'document_unread' : 'document_refused';
  return { kind, problems: failure.problems };
}

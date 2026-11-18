import type { ProtectedResource } from '@on.auto/identity';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';

export const healthPath = '/health';

export const apiCatalogPath = '/.well-known/api-catalog';

export interface PublicAddressing {
  readonly resource: ProtectedResource | undefined;
  readonly publicUrl?: string | undefined;
}

export function publicOriginOfRequest(request: Request, { resource, publicUrl }: PublicAddressing): string {
  return resource?.publicUrl ?? publicUrl ?? new URL(request.url).origin;
}

export function publicOriginOf(c: Context<ApiEnv>, addressing: PublicAddressing): string {
  return publicOriginOfRequest(c.req.raw, addressing);
}

export function apiCatalogLinkTo(address: string): string {
  return `<${address}>; rel="api-catalog"`;
}

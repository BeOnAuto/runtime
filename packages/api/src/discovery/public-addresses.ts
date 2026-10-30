import type { ProtectedResource } from '@on.auto/identity';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';

export const healthPath = '/health';

export const apiCatalogPath = '/.well-known/api-catalog';

export function publicOriginOf(c: Context<ApiEnv>, resource: ProtectedResource | undefined): string {
  return resource?.publicUrl ?? new URL(c.req.url).origin;
}

export function apiCatalogLinkTo(address: string): string {
  return `<${address}>; rel="api-catalog"`;
}

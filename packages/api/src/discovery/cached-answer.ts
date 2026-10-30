import { sha256Of } from '@on.auto/operations';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';

type HeaderFields = Readonly<Record<string, string>>;

export interface CachedAnswer {
  readonly body: string;
  readonly etag: string;
  readonly headers: HeaderFields;
  readonly unchangedHeaders: HeaderFields;
}

const keptForFiveMinutes = 'public, max-age=300';

const entityTags = /"[^"]*"/gu;

const noEntityTags: readonly string[] = [];

export function cachedAnswerOf(body: string, mediaType: string, more: HeaderFields = {}): CachedAnswer {
  const etag = `"${sha256Of(body)}"`;
  const unchangedHeaders = { etag, 'cache-control': keptForFiveMinutes, ...more };
  return { body, etag, unchangedHeaders, headers: { 'content-type': mediaType, ...unchangedHeaders } };
}

function namesTheEntity(ifNoneMatch: string, etag: string): boolean {
  return ifNoneMatch.trim() === '*' || (ifNoneMatch.match(entityTags) ?? noEntityTags).includes(etag);
}

export function answerOf(c: Context<ApiEnv>, { body, etag, headers, unchangedHeaders }: CachedAnswer): Response {
  return namesTheEntity(c.req.header('if-none-match') ?? '', etag)
    ? new Response(null, { status: 304, headers: unchangedHeaders })
    : new Response(body, { headers });
}

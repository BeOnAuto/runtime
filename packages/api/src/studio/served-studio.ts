import { servedStudioPath, type StudioSettings } from '@on.auto/identity';
import type { Context } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import type { RegisterRoutes } from '../routes.ts';
import { inlineScriptHashesIn, servedStudioPolicyOf } from './studio-policy.ts';
import { unreachableStudioPage } from './unreachable-studio.ts';

export interface StudioAnswer {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: Readonly<Uint8Array>;
  readonly freshForSeconds: number;
  readonly etag: string | undefined;
  readonly lastModified: string | undefined;
  readonly location: string | undefined;
}

export type StudioHost = (path: string) => Promise<StudioAnswer | undefined>;

export interface HostedStudio extends StudioSettings {
  readonly served: false;
}

export interface ServedStudio extends StudioSettings {
  readonly served: true;
  readonly host: StudioHost;
}

export type ApiStudio = HostedStudio | ServedStudio;

const studioRoot = servedStudioPath.slice(0, -1);

const encodedDot = /%2e/giu;

export function servesStudioAt(studio: ApiStudio): (path: string) => boolean {
  return (path) => studio.served && (path === studioRoot || path.startsWith(servedStudioPath));
}

function hostPathOf(c: Context<ApiEnv>): string | undefined {
  const { pathname } = new URL(c.req.url);
  const path = pathname.slice(studioRoot.length);
  return pathname.startsWith(servedStudioPath) && !path.replaceAll(encodedDot, '.').includes('..') ? path : undefined;
}

function cacheControlOf({ freshForSeconds }: StudioAnswer): string {
  return freshForSeconds > 0 ? `public, max-age=${freshForSeconds}, immutable` : 'no-cache';
}

function policyOf({ contentType, body }: StudioAnswer): string {
  const isPage = contentType?.startsWith('text/html') ?? false;
  return servedStudioPolicyOf(isPage ? inlineScriptHashesIn(new TextDecoder().decode(body)) : []);
}

function headersOf(answer: StudioAnswer): Headers {
  const given: readonly (readonly [string, string | undefined])[] = [
    ['content-type', answer.contentType],
    ['etag', answer.etag],
    ['last-modified', answer.lastModified],
    ['location', answer.location === undefined ? undefined : `${studioRoot}${answer.location}`],
  ];
  const headers = new Headers({ 'cache-control': cacheControlOf(answer), 'content-security-policy': policyOf(answer) });
  for (const [name, value] of given) {
    if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function responseOf(answer: StudioAnswer): Response {
  const headers = headersOf(answer);
  return new Response(answer.body.byteLength === 0 ? null : answer.body, { status: answer.status, headers });
}

function intoTheFolder(c: Context<ApiEnv>): Response {
  const { search } = new URL(c.req.url);
  return c.redirect(`${servedStudioPath}${search}`, 308);
}

async function studioAnswerOf({ origin, host }: ServedStudio, c: Context<ApiEnv>): Promise<Response> {
  if (c.req.path === studioRoot) {
    return intoTheFolder(c);
  }
  const path = hostPathOf(c);
  if (path === undefined) {
    return c.notFound();
  }
  const answer = await host(path);
  return answer === undefined ? unreachableStudioPage(origin) : responseOf(answer);
}

export function studioRoutes(studio: ApiStudio): RegisterRoutes {
  return (routes) => {
    if (studio.served) {
      routes.add('GET', `${servedStudioPath}*`, (c) => studioAnswerOf(studio, c));
    }
  };
}

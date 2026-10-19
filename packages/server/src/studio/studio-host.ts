import type { StudioAnswer, StudioHost } from '@on.auto/api';
import { boundedAnswerOf, type OutboundFetch } from '@on.auto/outbound';
import { toolBounds } from '@on.auto/tool-servers';
import { Function } from 'effect';

import type { KeptAnswer, KeptAnswers } from './kept-answers.ts';

export interface StudioBounds {
  readonly answerMs: number;
  readonly answerBytes: number;
}

export const studioBounds: StudioBounds = { answerMs: toolBounds.callMs, answerBytes: toolBounds.httpAnswerBytes };

export interface StudioHostReach {
  readonly origin: string;
  readonly fetch: OutboundFetch;
  readonly kept: KeptAnswers;
  readonly bounds: StudioBounds;
  readonly now: () => number;
}

interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Readonly<Uint8Array>;
}

interface Asking {
  readonly reach: StudioHostReach;
  readonly path: string;
  readonly held: KeptAnswer | undefined;
}

const ok = 200;

const notModified = 304;

function pageKeyOf(origin: string): string {
  return `${origin}/`;
}

function keyOf(origin: string, path: string): string {
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return lastSegment.includes('.') ? `${origin}${path}` : pageKeyOf(origin);
}

function validatorsOf(held: KeptAnswer | undefined): Readonly<Record<string, string>> {
  return {
    ...(held?.etag === undefined ? {} : { 'if-none-match': held.etag }),
    ...(held?.lastModified === undefined ? {} : { 'if-modified-since': held.lastModified }),
  };
}

function replyOf(answerBytes: number): (response: Readonly<Response>) => Promise<Reply> {
  return async (response) => {
    const body = await boundedAnswerOf(response, answerBytes, Function.constVoid).arrayBuffer();
    return { status: response.status, headers: response.headers, body: new Uint8Array(body) };
  };
}

function askedOf({ reach, path, held }: Asking): Promise<Reply | undefined> {
  const { origin, fetch, bounds } = reach;
  return fetch(`${origin}${path}`, { headers: validatorsOf(held), signal: AbortSignal.timeout(bounds.answerMs) })
    .then(replyOf(bounds.answerBytes))
    .catch(Function.constUndefined);
}

function directiveOf(written: string): readonly [string, string] {
  const directive = written.trim().toLowerCase();
  const equals = directive.indexOf('=');
  return equals === -1 ? [directive, ''] : [directive.slice(0, equals), directive.slice(equals + 1)];
}

function directivesOf(headers: Readonly<Headers>): ReadonlyMap<string, string> {
  return new Map((headers.get('cache-control') ?? '').split(',').map((written) => directiveOf(written)));
}

function secondsIn(text: string | null | undefined): number {
  const seconds = Number(text ?? 0);
  return Number.isFinite(seconds) ? seconds : 0;
}

function freshUntilOf(headers: Readonly<Headers>, now: number): number {
  const directives = directivesOf(headers);
  const lifetime = directives.has('immutable')
    ? secondsIn(directives.get('max-age')) - secondsIn(headers.get('age'))
    : 0;
  return now + Math.max(lifetime, 0) * 1000;
}

function headerIn(headers: Readonly<Headers>, name: string): string | undefined {
  return headers.get(name) ?? undefined;
}

function keptOf(key: string, { headers, body }: Reply, now: number): KeptAnswer {
  return {
    key,
    contentType: headerIn(headers, 'content-type'),
    etag: headerIn(headers, 'etag'),
    lastModified: headerIn(headers, 'last-modified'),
    keptAt: now,
    freshUntil: freshUntilOf(headers, now),
    body,
  };
}

function renewedOf(held: KeptAnswer, { headers }: Reply, now: number): KeptAnswer {
  return {
    ...held,
    etag: headerIn(headers, 'etag') ?? held.etag,
    lastModified: headerIn(headers, 'last-modified') ?? held.lastModified,
    keptAt: now,
    freshUntil: freshUntilOf(headers, now),
  };
}

function answerOf({ contentType, body, freshUntil, etag, lastModified }: KeptAnswer, now: number): StudioAnswer {
  const freshForSeconds = Math.max(Math.floor((freshUntil - now) / 1000), 0);
  return { status: ok, contentType, body, freshForSeconds, etag, lastModified, location: undefined };
}

function passedOn({ status, headers, body }: Reply, location?: string): StudioAnswer {
  return {
    status,
    contentType: headerIn(headers, 'content-type'),
    body,
    freshForSeconds: 0,
    etag: headerIn(headers, 'etag'),
    lastModified: headerIn(headers, 'last-modified'),
    location,
  };
}

function onTheHost({ reach, path }: Asking, { headers }: Reply): string | undefined {
  const location = headers.get('location');
  const target = location === null ? undefined : URL.parse(location, `${reach.origin}${path}`);
  return target?.origin === reach.origin ? `${target.pathname}${target.search}` : undefined;
}

function heldAnswerOf({ reach, held }: Asking): StudioAnswer | undefined {
  return held === undefined ? undefined : answerOf(held, reach.now());
}

async function keptAnswerOf({ reach, path, held }: Asking, reply: Reply): Promise<StudioAnswer> {
  const now = reach.now();
  const isPage = headerIn(reply.headers, 'content-type')?.startsWith('text/html') ?? false;
  const kept =
    reply.status === notModified && held !== undefined
      ? renewedOf(held, reply, now)
      : keptOf(isPage ? pageKeyOf(reach.origin) : `${reach.origin}${path}`, reply, now);
  await reach.kept.keep(kept);
  return answerOf(kept, now);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400 && status !== notModified;
}

function answerTo(asking: Asking, reply: Reply): StudioAnswer | Promise<StudioAnswer> | undefined {
  const { status, headers } = reply;
  if (isRedirect(status)) {
    const location = onTheHost(asking, reply);
    return location === undefined ? heldAnswerOf(asking) : passedOn(reply, location);
  }
  if (status === notModified) {
    return asking.held === undefined ? undefined : keptAnswerOf(asking, reply);
  }
  if (status >= 500 && asking.held !== undefined) {
    return heldAnswerOf(asking);
  }
  return status === ok && !directivesOf(headers).has('no-store') ? keptAnswerOf(asking, reply) : passedOn(reply);
}

export function studioHostOf(reach: StudioHostReach): StudioHost {
  return async (path) => {
    const held = await reach.kept.answerAt(keyOf(reach.origin, path));
    if (held !== undefined && held.freshUntil > reach.now()) {
      return answerOf(held, reach.now());
    }
    const asking = { reach, path, held };
    const reply = await askedOf(asking);
    return reply === undefined ? heldAnswerOf(asking) : answerTo(asking, reply);
  };
}

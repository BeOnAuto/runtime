import type { RenderClock } from '@on.auto/definitions/template';
import { longestCallRunMs } from '@on.auto/definitions/tool-blocks';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Clock, Effect, Result } from 'effect';

import type { KeptRequest } from '../replies/reply-taking.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { readingOf, readNamesItsMessage } from './request-readings.ts';

export const turnBounds = {
  readsEachTurn: 10,
  holdMs: 2 * longestCallRunMs,
  callMs: longestCallRunMs,
} as const;

export function roomForACall(heldAt: number): Effect.Effect<boolean> {
  return Effect.map(Clock.currentTimeMillis, (now) => heldAt + turnBounds.holdMs - now >= turnBounds.callMs);
}

export interface ReadingOfATurn {
  readonly reading: string;
  readonly first: KeptRequest;
  readonly requests: readonly KeptRequest[];
  readonly namesItsMessage: boolean;
}

function askedBy(request: KeptRequest, key: string) {
  return { to: request.row.party, sent: request.sent, key };
}

interface TurnRendering {
  readonly clock: RenderClock;
  readonly mostRequestBytesTo: ToolAccess['mostRequestBytesTo'];
}

function renderingOf(request: KeptRequest, { clock, mostRequestBytesTo }: TurnRendering) {
  return { clock, mostBytes: mostRequestBytesTo(routeOfRequest(request).server) };
}

function readingOfKept(request: KeptRequest, key: string, rendering: TurnRendering): string | undefined {
  const recorded = request.row.reading;
  if (recorded !== null) {
    return recorded;
  }
  const rendered = readingOf(routeOfRequest(request).replies, askedBy(request, key), renderingOf(request, rendering));
  return Result.isSuccess(rendered) ? rendered.success : undefined;
}

type Requests = readonly [KeptRequest, ...KeptRequest[]];

type Grouped = ReadonlyMap<string, Requests>;

function joined(grouped: Grouped, request: KeptRequest, reading: string): Grouped {
  const known = grouped.get(reading);
  return new Map(grouped).set(reading, known === undefined ? [request] : [...known, request]);
}

export function readingsOfTheTurn(
  kept: readonly KeptRequest[],
  key: string,
  rendering: TurnRendering,
): readonly ReadingOfATurn[] {
  const grouped = kept.reduce<Grouped>((readings, request) => {
    const reading = readingOfKept(request, key, rendering);
    return reading === undefined ? readings : joined(readings, request, reading);
  }, new Map());
  return [...grouped].map(([reading, requests]: readonly [string, Requests]) => {
    const [first] = requests;
    const asked = askedBy(first, key);
    const namesItsMessage = readNamesItsMessage(routeOfRequest(first).replies, asked, renderingOf(first, rendering));
    return { reading, first, requests, namesItsMessage };
  });
}

export function readingsInTurn(readings: readonly ReadingOfATurn[], from: number): readonly ReadingOfATurn[] {
  const start = from % readings.length;
  return [...readings.slice(start), ...readings.slice(0, start)].slice(0, turnBounds.readsEachTurn);
}

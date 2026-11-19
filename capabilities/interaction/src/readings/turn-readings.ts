import type { RenderClock } from '@on.auto/definitions/template';
import { longestCallRunMs } from '@on.auto/definitions/tool-blocks';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Clock, Effect } from 'effect';

import type { KeptRequest } from '../replies/reply-taking.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { inputsOf, type InputsLedger } from './request-inputs.ts';
import { readNamesItsMessage, readRequestOf, type RequestInputs } from './request-readings.ts';

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

interface TurnRendering {
  readonly clock: RenderClock;
  readonly mostRequestBytesTo: ToolAccess['mostRequestBytesTo'];
  readonly inputs: RequestInputs;
}

function renderingOf(request: KeptRequest, { clock, mostRequestBytesTo }: TurnRendering) {
  return { clock, mostBytes: mostRequestBytesTo(routeOfRequest(request).server) };
}
type Requests = readonly [KeptRequest, ...KeptRequest[]];

export type ReadingsOfTheTurn = readonly [ReadingOfATurn, ...ReadingOfATurn[]];

function firstOfEachReading(requests: readonly KeptRequest[]): readonly KeptRequest[] {
  return requests.filter(
    (request, index) => requests.findIndex(({ reading }) => reading === request.reading) === index,
  );
}

export function inputsOfTheTurn(
  ledger: InputsLedger,
  requests: readonly KeptRequest[],
): Effect.Effect<RequestInputs | undefined> {
  return inputsOf(ledger, firstOfEachReading(requests));
}

function readingOfRequests(requests: Requests, key: string, rendering: TurnRendering): ReadingOfATurn {
  const [first] = requests;
  const asked = readRequestOf(first, key, rendering.inputs);
  const namesItsMessage = readNamesItsMessage(routeOfRequest(first).replies, asked, renderingOf(first, rendering));
  return { reading: first.reading, first, requests, namesItsMessage };
}

export function readingsOfTheTurn(
  [first, ...later]: Requests,
  key: string,
  rendering: TurnRendering,
): ReadingsOfTheTurn {
  const own = readingOfRequests([first, ...later.filter(({ reading }) => reading === first.reading)], key, rendering);
  const [next, ...rest] = later.filter(({ reading }) => reading !== first.reading);
  return next === undefined ? [own] : [own, ...readingsOfTheTurn([next, ...rest], key, rendering)];
}

export function readsInATurn(requests: readonly Pick<KeptRequest, 'reading'>[]): number {
  return Math.min(new Set(requests.map(({ reading }) => reading)).size, turnBounds.readsEachTurn);
}

export function readingsInTurn(readings: readonly ReadingOfATurn[], from: number): readonly ReadingOfATurn[] {
  const start = from % readings.length;
  return [...readings.slice(start), ...readings.slice(0, start)].slice(0, turnBounds.readsEachTurn);
}

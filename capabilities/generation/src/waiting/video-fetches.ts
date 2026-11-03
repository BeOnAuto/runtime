import { recordedRunIn } from '@on.auto/definitions';
import { Clock, Effect } from 'effect';

import { generationBounds } from '../capability/generation-ports.ts';
import type { GatewayCall } from '../gateway/gateway-call.ts';
import type { GatewayRefusal } from '../gateway/gateway-refusals.ts';
import { videoFetchedOf } from '../gateway/video-call.ts';
import { fetchInFlightMs } from './poll-cadence.ts';
import { keptNow } from './waited-assets.ts';
import { succeededWith } from './waiting-ends.ts';
import {
  advanced,
  inFlightUntil,
  pollAgain,
  settled,
  type Waiting,
  type WaitingParts,
  type WaitingPlace,
} from './waiting-parts.ts';

export interface Made {
  readonly place: WaitingPlace;
  readonly waiting: Waiting;
  readonly call: GatewayCall;
  readonly now: number;
}

function stillAwaited(parts: WaitingParts, { address }: Waiting): Effect.Effect<boolean> {
  return Effect.map(recordedRunIn(parts.ledger, address), (recorded) => recorded?.awaitsSettlement === true);
}

function fetchedAndKept(parts: WaitingParts, { place, waiting, call }: Made): Effect.Effect<void, GatewayRefusal> {
  return Effect.gen(function* () {
    const mostBytes = (parts.bounds ?? generationBounds).mostBytes[waiting.madeBy.kind];
    const fetched = yield* videoFetchedOf(call, place.row.handle, mostBytes);
    if ('unanswered' in fetched) {
      return yield* pollAgain(parts, place, yield* Clock.currentTimeMillis, place.row.progress);
    }
    if (!(yield* stillAwaited(parts, waiting))) {
      return yield* Effect.undefined;
    }
    return yield* settled(parts, waiting, succeededWith(yield* keptNow(parts, place, waiting, fetched.fetched)));
  });
}

export function fetchedOnceAwaited(parts: WaitingParts, made: Made): Effect.Effect<void, GatewayRefusal> {
  return Effect.gen(function* () {
    yield* advanced(parts, made.place, inFlightUntil(made.place, made.now + fetchInFlightMs(parts.answerMs)));
    return (yield* stillAwaited(parts, made.waiting)) ? yield* fetchedAndKept(parts, made) : undefined;
  });
}

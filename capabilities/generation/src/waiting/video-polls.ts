import { Effect } from 'effect';

import type { GatewayCall } from '../gateway/gateway-call.ts';
import { videoStandingOf } from '../gateway/video-call.ts';
import { spentOf } from '../run/made-by.ts';
import { noGatewayNamed } from '../run/runnable-model.ts';
import { pollWaits } from './poll-cadence.ts';
import { fetchedOnceAwaited } from './video-fetches.ts';
import { keptBefore } from './waited-assets.ts';
import { refusalsSettled, succeededWith } from './waiting-ends.ts';
import {
  advanced,
  cadenceOf,
  inFlightUntil,
  pollAgain,
  settled,
  waitingIn,
  type Waiting,
  type WaitingParts,
  type WaitingPlace,
} from './waiting-parts.ts';

function callOf(parts: WaitingParts, place: WaitingPlace, waiting: Waiting): GatewayCall | undefined {
  const gateway = parts.gateways.find(({ name }) => name === place.row.gateway);
  return gateway === undefined
    ? undefined
    : {
        gateway,
        fetch: parts.fetch,
        record: spentOf(waiting.madeBy),
        ...(parts.answerMs === undefined ? {} : { answerMs: parts.answerMs }),
      };
}

function asked(parts: WaitingParts, place: WaitingPlace, waiting: Waiting, now: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    const call = callOf(parts, place, waiting);
    if (call === undefined) {
      return yield* Effect.fail(noGatewayNamed(place.row.gateway, parts.gateways));
    }
    const standing = yield* videoStandingOf(call, place.row.handle);
    if (standing.standing === 'made') {
      return yield* fetchedOnceAwaited(parts, { place, waiting, call, now });
    }
    return yield* pollAgain(parts, place, now, standing.standing === 'making' ? standing.progress : place.row.progress);
  }).pipe(Effect.catchTags(refusalsSettled(parts, waiting)));
}

function keptOrAsked(parts: WaitingParts, place: WaitingPlace, waiting: Waiting, now: number): Effect.Effect<void> {
  return Effect.flatMap(keptBefore(parts, place, waiting), (before) =>
    before === undefined ? asked(parts, place, waiting, now) : settled(parts, waiting, succeededWith(before)),
  );
}

export function polled(parts: WaitingParts, place: WaitingPlace, now: number): Effect.Effect<void> {
  if (now >= place.row.waits_until) {
    return advanced(parts, place, { ...cadenceOf(place), next_poll_at: null });
  }
  return Effect.gen(function* () {
    yield* advanced(parts, place, inFlightUntil(place, now + pollWaits.inFlightMs));
    const waiting = yield* waitingIn(parts, place);
    return waiting === undefined ? undefined : yield* keptOrAsked(parts, place, waiting, now);
  });
}

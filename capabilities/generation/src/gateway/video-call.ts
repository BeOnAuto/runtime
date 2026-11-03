import { Effect, type Schema } from 'effect';

import {
  bodyWithin,
  costIn,
  isVideo,
  jsonOf,
  namedMediaTypeOf,
  videoAnswerIn,
  type VideoAnswer,
} from './gateway-answers.ts';
import { isTimeout, refusalIn, spentAt, type GatewayCall } from './gateway-call.ts';
import {
  bytesRefusedBy,
  failedAtTheProvider,
  forgottenBy,
  isPassing,
  notOfTheKind,
  tooLargeAnAsset,
  unreachedBy,
  unreadableAnswer,
  type GatewayRefusal,
  type Rejecting,
} from './gateway-refusals.ts';
import { gatewayRequestOf, videoContentRequestOf, videoStandingRequestOf } from './gateway-requests.ts';
import {
  gatewayAnswerMs,
  mostRefusalBytes,
  standingAnswerMs,
  type Generated,
  type GenerationRequest,
} from './generation-gateway.ts';

export interface VideoAsked {
  readonly handle: string;
  readonly costUsd?: number;
}

export type VideoStanding =
  | { readonly standing: 'making'; readonly progress: number | null }
  | { readonly standing: 'made' }
  | { readonly standing: 'unanswered' };

export type VideoFetched = { readonly fetched: Generated } | { readonly unanswered: true };

interface Refused {
  readonly refused: GatewayRefusal;
}

type NotAnswered = Refused | { readonly unanswered: true };

const madeStatus = 'completed';

const failedStatus = 'failed';

const theKind = 'video';

const unanswered: VideoStanding = { standing: 'unanswered' };

const notFetched: VideoFetched = { unanswered: true };

type Standing = VideoStanding | Refused;

type Fetching = VideoFetched | Refused;

function progressOf(progress: number | null | undefined): number | null {
  return progress !== null && progress !== undefined && progress >= 0 && progress <= 100 ? Math.round(progress) : null;
}

function standingOf(gateway: string, answer: VideoAnswer, spent: Schema.JsonObject): Standing {
  if (answer.status === madeStatus) {
    return { standing: 'made' };
  }
  if (answer.status === failedStatus) {
    return { refused: failedAtTheProvider(gateway, theKind, answer.error, spent) };
  }
  return { standing: 'making', progress: progressOf(answer.progress) };
}

async function answerIn(response: Readonly<Response>): Promise<VideoAnswer | undefined> {
  const read = await bodyWithin(response.body, mostRefusalBytes);
  return 'bytes' in read ? videoAnswerIn(jsonOf(read.bytes)) : undefined;
}

async function notAnsweredIn(
  gateway: string,
  response: Readonly<Response>,
  spent: Schema.JsonObject,
  rejected?: Rejecting,
) {
  if (isPassing(response.status)) {
    await response.body?.cancel();
    const passing: NotAnswered = { unanswered: true };
    return passing;
  }
  const refused: NotAnswered =
    response.status === 404
      ? { refused: forgottenBy(gateway, theKind, spent) }
      : { refused: await refusalIn(gateway, response, rejected) };
  return refused;
}

type Asking = { readonly asked: VideoAsked } | { readonly refused: GatewayRefusal };

async function askedIn(call: GatewayCall, response: Readonly<Response>): Promise<Asking> {
  const gateway = call.gateway.name;
  if (!response.ok) {
    return { refused: await refusalIn(gateway, response) };
  }
  const cost = costIn(response.headers, call.gateway.cost_header);
  const spent = spentAt(call, cost);
  const answer = await answerIn(response);
  if (answer === undefined) {
    return { refused: unreadableAnswer(gateway, 'id of the video it was asked for', spent) };
  }
  if (answer.status === failedStatus) {
    return { refused: failedAtTheProvider(gateway, theKind, answer.error, spent) };
  }
  return { asked: cost === undefined ? { handle: answer.id } : { handle: answer.id, costUsd: cost } };
}

function signalWithin(interrupted: Readonly<AbortSignal>, answerMs: number): AbortSignal {
  return AbortSignal.any([interrupted, AbortSignal.timeout(answerMs)]);
}

export function videoAskedOf(call: GatewayCall, request: GenerationRequest): Effect.Effect<VideoAsked, GatewayRefusal> {
  const answerMs = call.answerMs ?? gatewayAnswerMs;
  return Effect.gen(function* () {
    const asking = yield* Effect.tryPromise({
      try: async (interrupted: Readonly<AbortSignal>) =>
        askedIn(call, await call.fetch(gatewayRequestOf(call.gateway, request, signalWithin(interrupted, answerMs)))),
      catch: (error) => unreachedBy(call.gateway.name, isTimeout(error), answerMs),
    });
    if ('refused' in asking) {
      return yield* Effect.fail(asking.refused);
    }
    return asking.asked;
  });
}

async function standingIn(call: GatewayCall, response: Readonly<Response>): Promise<Standing> {
  const gateway = call.gateway.name;
  const spent = spentAt(call);
  if (!response.ok) {
    const notAnswered = await notAnsweredIn(gateway, response, spent);
    return 'refused' in notAnswered ? notAnswered : unanswered;
  }
  const answer = await answerIn(response);
  return answer === undefined ? unanswered : standingOf(gateway, answer, spent);
}

export function videoStandingOf(call: GatewayCall, handle: string): Effect.Effect<VideoStanding, GatewayRefusal> {
  return Effect.gen(function* () {
    const standing = yield* Effect.orElseSucceed(
      Effect.tryPromise(async (interrupted: Readonly<AbortSignal>) =>
        standingIn(
          call,
          await call.fetch(videoStandingRequestOf(call.gateway, handle, signalWithin(interrupted, standingAnswerMs))),
        ),
      ),
      (): Standing => unanswered,
    );
    if ('refused' in standing) {
      return yield* Effect.fail(standing.refused);
    }
    return standing;
  });
}

async function fetchedIn(call: GatewayCall, response: Readonly<Response>, mostBytes: number): Promise<Fetching> {
  const gateway = call.gateway.name;
  const spent = spentAt(call);
  if (!response.ok) {
    return notAnsweredIn(gateway, response, spent, bytesRefusedBy(theKind));
  }
  const named = namedMediaTypeOf(response.headers.get('content-type'));
  if (named !== undefined && !isVideo(named)) {
    return { refused: notOfTheKind(gateway, named, theKind, spent) };
  }
  const read = await bodyWithin(response.body, mostBytes);
  return 'bytes' in read
    ? { fetched: { bytes: read.bytes, mediaType: named ?? 'video/mp4' } }
    : { refused: tooLargeAnAsset(theKind, mostBytes, spent) };
}

export function videoFetchedOf(
  call: GatewayCall,
  handle: string,
  mostBytes: number,
): Effect.Effect<VideoFetched, GatewayRefusal> {
  const answerMs = call.answerMs ?? gatewayAnswerMs;
  return Effect.gen(function* () {
    const fetched = yield* Effect.orElseSucceed(
      Effect.tryPromise(async (interrupted: Readonly<AbortSignal>) =>
        fetchedIn(
          call,
          await call.fetch(videoContentRequestOf(call.gateway, handle, signalWithin(interrupted, answerMs))),
          mostBytes,
        ),
      ),
      (): Fetching => notFetched,
    );
    if ('refused' in fetched) {
      return yield* Effect.fail(fetched.refused);
    }
    return fetched;
  });
}

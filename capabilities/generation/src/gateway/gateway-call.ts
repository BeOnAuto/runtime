import { Effect, Predicate, type Schema } from 'effect';

import { audioMediaTypeOf, bodyWithin, costIn, imageIn, isAudio, jsonOf, namedMediaTypeOf } from './gateway-answers.ts';
import {
  notOfTheKind,
  refusalOf,
  tooLargeAnAsset,
  unreachedBy,
  unreadableAnswer,
  type GatewayRefusal,
  type Rejecting,
} from './gateway-refusals.ts';
import { gatewayRequestOf } from './gateway-requests.ts';
import {
  gatewayAnswerMs,
  mostRefusalBytes,
  type GatewayFetch,
  type Generated,
  type GenerationGateway,
  type GenerationRequest,
} from './generation-gateway.ts';

export interface GatewayCall {
  readonly gateway: GenerationGateway;
  readonly fetch: GatewayFetch;
  readonly answerMs?: number;
  readonly record?: Schema.JsonObject;
}

const mebibyte = 1_048_576;

function base64Bytes(mostBytes: number): number {
  return Math.ceil((mostBytes * 4) / 3) + mebibyte;
}

export function isTimeout(error: unknown): boolean {
  return Predicate.hasProperty(error, 'name') && error.name === 'TimeoutError';
}

export async function refusalIn(
  gateway: string,
  response: Readonly<Response>,
  rejected?: Rejecting,
): Promise<GatewayRefusal> {
  const read = await bodyWithin(response.body, mostRefusalBytes);
  return refusalOf(gateway, response.status, 'bytes' in read ? jsonOf(read.bytes) : undefined, rejected);
}

type Answered = { readonly generated: Generated } | { readonly refused: GatewayRefusal };

interface Reading {
  readonly gateway: string;
  readonly mostBytes: number;
  readonly spent: Schema.JsonObject;
}

async function imageAnswered({ gateway, mostBytes, spent }: Reading, response: Readonly<Response>): Promise<Answered> {
  const read = await bodyWithin(response.body, base64Bytes(mostBytes));
  if (!('bytes' in read)) {
    return { refused: tooLargeAnAsset('image', mostBytes, spent) };
  }
  const image = imageIn(jsonOf(read.bytes));
  if (image === undefined) {
    return { refused: unreadableAnswer(gateway, 'image', spent) };
  }
  return image.bytes.byteLength > mostBytes
    ? { refused: tooLargeAnAsset('image', mostBytes, spent) }
    : { generated: image };
}

async function audioAnswered(
  { gateway, mostBytes, spent }: Reading,
  response: Readonly<Response>,
  format: string,
): Promise<Answered> {
  const named = namedMediaTypeOf(response.headers.get('content-type'));
  if (named !== undefined && !isAudio(named)) {
    return { refused: notOfTheKind(gateway, named, 'audio', spent) };
  }
  const read = await bodyWithin(response.body, mostBytes);
  if (!('bytes' in read)) {
    return { refused: tooLargeAnAsset('audio', mostBytes, spent) };
  }
  return {
    generated: { bytes: read.bytes, mediaType: audioMediaTypeOf(named, format) },
  };
}

export function spentAt(call: Pick<GatewayCall, 'record'>, cost?: number): Schema.JsonObject {
  return Object.assign({}, call.record, cost === undefined ? {} : { cost_usd: cost });
}

async function answered(
  call: GatewayCall,
  request: GenerationRequest,
  response: Readonly<Response>,
  mostBytes: number,
): Promise<Answered> {
  if (!response.ok) {
    return { refused: await refusalIn(call.gateway.name, response) };
  }
  const cost = costIn(response.headers, call.gateway.cost_header);
  const reading = { gateway: call.gateway.name, mostBytes, spent: spentAt(call, cost) };
  const read =
    request.kind === 'image'
      ? await imageAnswered(reading, response)
      : await audioAnswered(reading, response, String(request.parameters.format));
  return 'refused' in read || cost === undefined ? read : { generated: { ...read.generated, costUsd: cost } };
}

export function generatedBy(
  call: GatewayCall,
  request: GenerationRequest,
  mostBytes: number,
): Effect.Effect<Generated, GatewayRefusal> {
  const answerMs = call.answerMs ?? gatewayAnswerMs;
  return Effect.gen(function* () {
    const read = yield* Effect.tryPromise({
      try: async (interrupted: Readonly<AbortSignal>) => {
        const signal = AbortSignal.any([interrupted, AbortSignal.timeout(answerMs)]);
        return answered(call, request, await call.fetch(gatewayRequestOf(call.gateway, request, signal)), mostBytes);
      },
      catch: (error) => unreachedBy(call.gateway.name, isTimeout(error), answerMs),
    });
    if ('refused' in read) {
      return yield* Effect.fail(read.refused);
    }
    return read.generated;
  });
}

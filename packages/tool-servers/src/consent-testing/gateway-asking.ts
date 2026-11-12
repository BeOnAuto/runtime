import { randomBytes } from 'node:crypto';

import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type {
  ConsentClient,
  ConsentClientOptions,
  ConsentWay,
  FinishedConsent,
  HandleFinishAsked,
  StartAsked,
  StartedConsent,
} from '../consent/consent-client.ts';
import { consentClientWith, everyHost, returnAddress, studioBase } from './consent-fakes.ts';
import { serveFakeGateway, type FakeGateway, type FakeGatewayOptions } from './fake-gateway.ts';

const issuer = 'https://accounts.example.com';

export async function gatewayServed(options: FakeGatewayOptions = {}): Promise<FakeGateway> {
  const gateway = await serveFakeGateway(options);
  onTestFinished(gateway.close);
  return gateway;
}

export function wayThrough(gateway: Pick<FakeGateway, 'url'>): ConsentWay {
  return { issuer, scope: 'channels:read', gateway: { url: gateway.url } };
}

export const wayWithNoGateway: ConsentWay = { issuer };

export function startAskedThrough(gateway: Pick<FakeGateway, 'url'>): StartAsked {
  return {
    server: { type: 'openapi' },
    way: wayThrough(gateway),
    returnAddress,
    reaches: everyHost,
    state: randomBytes(32).toString('base64url'),
    studioBase,
  };
}

export function switchedOn(options: Partial<ConsentClientOptions> = {}): ConsentClient {
  return consentClientWith({ gateways: true, ...options });
}

export function finishAskedThrough(
  gateway: Pick<FakeGateway, 'url'>,
  { client, verifier }: StartedConsent,
  handle: string,
): HandleFinishAsked {
  const { state: _state, studioBase: _base, ...asked } = startAskedThrough(gateway);
  return { ...asked, client, verifier, handle };
}

export interface HandedOver {
  readonly started: StartedConsent;
  readonly finished: FinishedConsent;
}

export async function handedOverAt(gateway: FakeGateway, client = switchedOn()): Promise<HandedOver> {
  const started = await Effect.runPromise(client.start(startAskedThrough(gateway)));
  const { handle } = gateway.allow(started.url);
  return { started, finished: await Effect.runPromise(client.finish(finishAskedThrough(gateway, started, handle))) };
}

export function refusalOf<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

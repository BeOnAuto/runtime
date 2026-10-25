import { createHash } from 'node:crypto';

import { Effect, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { consentServiceOf } from '../consent-through-auto/consent-service.ts';
import {
  consentRegistration,
  consentedAt,
  fakeConsentServiceAnswers,
  fakeMcpAnswers,
  type FetchHandler,
} from '../testing/index.ts';
import { studioSession } from './auto-consents.ts';

const vendorOrigin = 'https://vendor.example.com';

const serviceOrigin = 'https://consents.example.com';

const anotherStudio = 'https://studio.another.example.com/';

const challenge = createHash('sha256').update('a-handoff-verifier-of-forty-three-characters').digest('base64url');

function throughHandlers() {
  const handlers = new Map<string, FetchHandler>();
  const fetch = (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    return Option.getOrThrow(Option.fromNullishOr(handlers.get(new URL(request.url).origin)))(request);
  };
  return { handlers, fetch };
}

function servedOn(studioBase: string) {
  const routed = throughHandlers();
  const service = fakeConsentServiceAnswers({
    vendor: { origin: vendorOrigin },
    now: () => 0,
    fetch: routed.fetch,
    studioBase,
  });
  routed.handlers.set(serviceOrigin, service.handler);
  const calls = consentServiceOf({
    fetch: routed.fetch,
    url: serviceOrigin,
    requestMs: 5000,
    requestTimeout: (ms) => AbortSignal.timeout(ms),
  });
  const start = calls.start({
    issuer: vendorOrigin,
    scope: 'files.read',
    parameters: undefined,
    resource: undefined,
    returnTo: { kind: 'hosted', base: studioBase },
    challenge,
  });
  return { routed, calls, start };
}

describe('the answers of the fake consent service', () => {
  it('reach its vendor through the fetch they are given and send a person back to the Studio base they are given, so a test reaches both through handlers of its own', async () => {
    const { routed, calls, start } = servedOn(anotherStudio);
    const vendor = fakeMcpAnswers({
      client: consentRegistration({ redirectUris: [`${anotherStudio}connect-return`] }),
    });
    routed.handlers.set(vendorOrigin, vendor.handlerAt(vendorOrigin));

    const started = await Effect.runPromise(start);
    const { code } = await consentedAt(started.url, routed.fetch);
    const redeemed = await Effect.runPromise(calls.redeem(started.state, studioSession, { code }));

    expect(new URL(started.url).searchParams.get('redirect_uri')).toBe(`${anotherStudio}connect-return`);
    expect([typeof redeemed.handle, vendor.tokenRequests()]).toEqual(['string', 1]);
  });

  it('refuse a hosted return to a Studio base that does not end in a slash, which the runtime never names', async () => {
    const { start } = servedOn('https://studio.another.example.com');

    expect(Exit.isFailure(await Effect.runPromiseExit(start))).toBe(true);
  });
});

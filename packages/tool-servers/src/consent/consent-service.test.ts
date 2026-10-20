import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { serviceCallsAt, studioSession } from '../testing/index.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import type { ServiceStartAsked } from './consent-service.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function answeringEvery(answer: () => Response): Promise<string> {
  const answering = await serveOnLoopback(() => () => Promise.resolve(answer()));
  closing.push(answering.close);
  return answering.origin;
}

const answered = 'answered';

function outcomeOf<A, E>(effect: Effect.Effect<A, E>): Promise<E | typeof answered> {
  return Effect.runPromise(Effect.match(effect, { onFailure: (failure) => failure, onSuccess: () => answered }));
}

const issuer = 'https://accounts.example.com';

const start: ServiceStartAsked = {
  issuer,
  scope: undefined,
  parameters: undefined,
  resource: undefined,
  returnTo: { kind: 'hosted' },
  challenge: 'a-challenge',
};

function everyCallAt(url: string) {
  const calls = serviceCallsAt({ url });
  const tokens = { access_token: 'a', token_type: 'Bearer' };
  return Promise.all([
    outcomeOf(calls.clients),
    outcomeOf(calls.start(start)),
    outcomeOf(calls.describe('a-state', studioSession)),
    outcomeOf(calls.redeem('a-state', studioSession, { code: 'a-code' })),
    outcomeOf(calls.takeHandoff('a-handle', Redacted.make('a-verifier'))),
    outcomeOf(calls.refresh({ issuer, refreshToken: 'r', connectionKey: 'k', resource: undefined })),
    outcomeOf(calls.revoke({ issuer, tokens })),
  ]);
}

const unanswered = { refused: 'unanswered' };

describe('a consent service that answers a status the contract does not hold', () => {
  it('is unanswered for every call, as an authorization server that does not answer is', async () => {
    const url = await answeringEvery(() => new Response('not a document', { status: 500 }));

    expect(await everyCallAt(url)).toEqual(Array.from({ length: 7 }, () => unanswered));
  });

  it('answers a start it refuses as having no client, and every other refusal without a word of its own as unanswered', async () => {
    const url = await answeringEvery(() => new Response('not a document', { status: 400 }));

    expect(await everyCallAt(url)).toEqual([
      unanswered,
      { refused: 'no_client' },
      unanswered,
      unanswered,
      unanswered,
      unanswered,
      unanswered,
    ]);
  });
});

describe('a consent service that answers what the contract does not hold', () => {
  it('is unanswered for every call whose answer it must read, and answered for a revocation, which it need not', async () => {
    const url = await answeringEvery(() => new Response('not a document', { status: 200 }));

    expect(await everyCallAt(url)).toEqual([...Array.from({ length: 6 }, () => unanswered), answered]);
  });

  it('is unanswered for a handoff whose tokens end at a time that is none', async () => {
    const tokens = { access_token: 'a', token_type: 'Bearer', expires_at: 'tomorrow' };
    const url = await answeringEvery(() => Response.json({ client_id: 'auto-runtime', tokens, connection_key: 'k' }));

    expect(await outcomeOf(serviceCallsAt({ url }).takeHandoff('a-handle', Redacted.make('a-verifier')))).toEqual(
      unanswered,
    );
  });
});

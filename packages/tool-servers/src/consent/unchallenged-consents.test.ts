import { Effect, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import {
  consentClientWith,
  finishAskedOf,
  hostOf,
  registeredAt,
  returnAddress,
  startAskedAt,
  tokensKeptBy,
} from '../testing/index.ts';
import { servedForConsent, type FakeMcpServer } from '../testing/served-fakes.ts';
import type { ConsentClient, ConsentWay, FinishAsked, StartAsked } from './consent-client.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function takingNoChallenge(): Promise<FakeMcpServer> {
  const fake = await servedForConsent({ takesNoChallenge: true });
  closing.push(fake.close);
  return fake;
}

function writtenOutAt(fake: FakeMcpServer, way: Partial<ConsentWay> = {}): StartAsked {
  const endpoints = { authorization_endpoint: `${fake.origin}/authorize`, token_endpoint: `${fake.origin}/token` };
  return { ...startAskedAt(fake, { ...endpoints, ...way }), server: { type: 'openapi' } };
}

function refusedAtTheStart(client: ConsentClient, asked: StartAsked) {
  return Effect.runPromise(Effect.flip(client.start(asked)));
}

function refusedAtTheFinish(client: ConsentClient, asked: FinishAsked) {
  return Effect.runPromise(Effect.flip(client.finish(asked)));
}

const unchallenged: Partial<ConsentWay> = { pkce: 'none' };

describe('the consent of a way whose written-out server takes no PKCE', () => {
  it('starts without a challenge and finishes without a verifier, by a client with a secret', async () => {
    const fake = await takingNoChallenge();
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });

    const asked = await finishAskedOf(client, writtenOutAt(fake, unchallenged));
    const done = await Effect.runPromise(client.finish(asked).pipe(Effect.provide(TestClock.layer())));
    const start = await Effect.runPromise(client.start(writtenOutAt(fake, unchallenged)));

    expect(Object.fromEntries(new URL(start.url).searchParams)).toEqual({
      response_type: 'code',
      client_id: 'auto-runtime',
      redirect_uri: returnAddress,
      state: 'state-1',
      scope: 'files.read',
    });
    expect(await admitted(fake, tokensKeptBy(done).access_token)).toBe(true);
  });

  it('starts without a challenge by a client with a key, whose assertion binds the code as a secret does', async () => {
    const fake = await takingNoChallenge();
    const keyed = registeredAt(fake.origin, {
      credential: { kind: 'private_key', privateKey: Redacted.make('a key in PEM'), algorithm: 'RS256' },
    });

    const start = await Effect.runPromise(
      consentClientWith({ registeredClients: [keyed] }).start(writtenOutAt(fake, unchallenged)),
    );

    expect(new URL(start.url).searchParams.has('code_challenge')).toBe(false);
  });
});

describe('the refusals of a way whose server takes no PKCE', () => {
  it('fails at the token endpoint where the way does not say so, since the server refuses a code redeemed with a verifier', async () => {
    const fake = await takingNoChallenge();
    const client = consentClientWith({ registeredClients: [registeredAt(fake.origin)] });

    expect(await refusedAtTheFinish(client, await finishAskedOf(client, writtenOutAt(fake)))).toEqual({
      refused: 'unanswered',
      call: { step: 'token', host: hostOf(fake), answer: { status: 401, retryAfterMs: null } },
    });
  });

  it('takes no public client, whose code nothing but a challenge binds, and refuses a server it discovers that lists no S256', async () => {
    const fake = await takingNoChallenge();
    const open = registeredAt(fake.origin, { credential: { kind: 'public' } });

    expect([
      await refusedAtTheStart(consentClientWith({ registeredClients: [open] }), writtenOutAt(fake, unchallenged)),
      await refusedAtTheStart(
        consentClientWith({ registeredClients: [registeredAt(fake.origin)] }),
        startAskedAt(fake, unchallenged),
      ),
    ]).toEqual([{ refused: 'no_client' }, { refused: 'no_challenge' }]);
  });
});

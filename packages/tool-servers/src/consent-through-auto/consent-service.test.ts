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
  returnTo: { kind: 'hosted', base: 'https://studio.example.com/' },
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
    outcomeOf(calls.revoke({ issuer, tokens, connectionKey: 'k' })),
  ]);
}

const unanswered = { refused: 'unanswered' };

describe('a consent service that answers a status the contract does not hold', () => {
  it('is unanswered for every call, as an authorization server that does not answer is', async () => {
    const url = await answeringEvery(() => new Response('not a document', { status: 500 }));

    expect(await everyCallAt(url)).toEqual(Array.from({ length: 7 }, () => unanswered));
  });

  it('answers a start it refuses as one it will not make, and every other refusal without a word of its own as unanswered', async () => {
    const url = await answeringEvery(() => new Response('not a document', { status: 400 }));

    expect(await everyCallAt(url)).toEqual([
      unanswered,
      { refused: 'start_refused' },
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

describe('the clients a consent service lists', () => {
  it('are read with the scopes a client names, and without them where it names none', async () => {
    const clients = [
      { issuer, client_id: 'auto-any' },
      { issuer, client_id: 'auto-reading', scopes: ['files.read'] },
    ];
    const url = await answeringEvery(() => Response.json({ clients }));

    expect(await Effect.runPromise(serviceCallsAt({ url }).clients)).toEqual(clients);
  });

  it('are unanswered where a client names an empty scope', async () => {
    const url = await answeringEvery(() =>
      Response.json({ clients: [{ issuer, client_id: 'auto-reading', scopes: [''] }] }),
    );

    expect(await outcomeOf(serviceCallsAt({ url }).clients)).toEqual(unanswered);
  });
});

function problemAnswer(status: number, members: Readonly<Record<string, unknown>>): () => Response {
  return () =>
    Response.json({ type: 'about:blank', status, title: 'Refused', detail: 'Refused', ...members }, { status });
}

async function refreshAt(answer: () => Response) {
  const calls = serviceCallsAt({ url: await answeringEvery(answer) });
  return outcomeOf(calls.refresh({ issuer, refreshToken: 'r', connectionKey: 'k', resource: undefined }));
}

async function revokeAt(answer: () => Response) {
  const calls = serviceCallsAt({ url: await answeringEvery(answer) });
  return outcomeOf(calls.revoke({ issuer, tokens: { access_token: 'a', token_type: 'Bearer' }, connectionKey: 'k' }));
}

async function handoffAt(answer: () => Response) {
  return outcomeOf(serviceCallsAt({ url: await answeringEvery(answer) }).takeHandoff('h', Redacted.make('v')));
}

describe('the refusals a consent service names', () => {
  it('end a renewal only where they name the refusal at the status the contract gives it, and are unanswered otherwise', async () => {
    expect([
      await refreshAt(problemAnswer(400, { refused: 'invalid_grant' })),
      await refreshAt(problemAnswer(403, { refused: 'unknown_key' })),
      await refreshAt(problemAnswer(403, {})),
      await refreshAt(problemAnswer(400, { refused: 'unknown_key' })),
      await refreshAt(() => new Response('Forbidden', { status: 403 })),
    ]).toEqual([{ refused: 'invalid_grant' }, { refused: 'unknown_key' }, unanswered, unanswered, unanswered]);
  });

  it('say a revocation did not happen only with the status of the authorization server on a 502, and a key unknown on a 403', async () => {
    expect([
      await revokeAt(problemAnswer(502, { refused: 'not_revoked', vendor_status: 401 })),
      await revokeAt(problemAnswer(502, { refused: 'not_revoked' })),
      await revokeAt(problemAnswer(400, { refused: 'not_revoked', vendor_status: 401 })),
      await revokeAt(problemAnswer(403, { refused: 'unknown_key' })),
      await revokeAt(problemAnswer(403, {})),
    ]).toEqual([
      { refused: 'not_revoked', status: 401 },
      unanswered,
      unanswered,
      { refused: 'unknown_key' },
      unanswered,
    ]);
  });

  it('refuse a handoff for a wrong verifier only where they name it', async () => {
    expect([
      await handoffAt(problemAnswer(403, { refused: 'wrong_verifier' })),
      await handoffAt(problemAnswer(403, {})),
    ]).toEqual([{ refused: 'code' }, unanswered]);
  });
});

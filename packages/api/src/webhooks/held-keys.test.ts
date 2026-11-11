import { Function, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import type { KeysLimited, SignedAnswerServing } from '../index.ts';
import { call } from '../testing/api-calls.ts';
import {
  answerBody,
  answerPath,
  approvalsId,
  approvalsSecret,
  keyOf,
  otherSecret,
  runId,
  servedWith,
  signedHeaders,
} from '../testing/signed-deliveries.ts';

type HeldKeys = Pick<SignedAnswerServing, 'holdsKeys' | 'signingKeys'>;

function delivered(handler: ReturnType<typeof servedWith>['handler']) {
  return call(handler, answerPath, { method: 'POST', headers: signedHeaders(), body: answerBody });
}

function holding(held: readonly string[], current: readonly string[]): HeldKeys {
  return {
    holdsKeys: true,
    signingKeys: (_org, _connection, read) =>
      Promise.resolve({
        connection: approvalsId,
        keys: (read === 'held' ? held : current).map((secret) => keyOf(secret)),
      }),
  };
}

function holdingThenLimited(held: readonly string[], limited: KeysLimited): HeldKeys {
  return {
    holdsKeys: true,
    signingKeys: (_org, _connection, read) =>
      Promise.resolve(
        read === 'held' ? { connection: approvalsId, keys: held.map((secret) => keyOf(secret)) } : limited,
      ),
  };
}

describe('a delivery to a host that holds the keys of its connections', () => {
  it('is verified with the keys the host holds, no current keys asked, and the key that verified handed to the take', async () => {
    const { handler, served } = servedWith(holding([approvalsSecret], []));

    const answer = await delivered(handler);

    expect(answer.status).toBe(200);
    expect(served.taken).toEqual([
      expect.objectContaining({ connection: approvalsId, connectionName: 'approvals', takenFor: `ops/${runId}` }),
    ]);
    expect(served.taken.map(({ verifiedWith }) => Redacted.value(verifiedWith))).toEqual([
      Redacted.value(keyOf(approvalsSecret)),
    ]);
  });

  it('asks for the current keys where the keys it holds do not verify it, and is taken by a secret set since', async () => {
    const asked: string[] = [];
    const keys = holding([otherSecret], [approvalsSecret]);
    const { handler, served } = servedWith({
      ...keys,
      signingKeys: (org, connection, read) => {
        asked.push(read);
        return keys.signingKeys(org, connection, read);
      },
    });

    const answer = await delivered(handler);

    expect(answer.status).toBe(200);
    expect(asked).toEqual(['held', 'current']);
    expect(served.answered).toHaveLength(1);
  });
});

describe('a delivery the keys a host holds do not prove', () => {
  it('is the one 401 where neither the keys it holds nor the current ones verify it', async () => {
    const { handler, served } = servedWith(holding([otherSecret], [otherSecret]));

    const answer = await delivered(handler);

    expect(answer.status).toBe(401);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['not_signed']);
    expect(served.taken).toEqual([]);
  });

  it('is the one 401 where the key that verified is no longer the connection’s as it is taken, nothing handed on', async () => {
    const { handler, served } = servedWith({
      ...holding([approvalsSecret], []),
      taken: () => Promise.resolve().then(Function.constUndefined),
    });

    const answer = await delivered(handler);

    expect([answer.status, answer.text]).toEqual([
      401,
      '{"type":"https://on.auto/problems/unauthenticated","title":"Unauthenticated","status":401,"detail":"The delivery is not signed by the connection its address names","reason":"unauthenticated"}',
    ]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['not_signed']);
    expect(served.answered).toEqual([]);
  });
});

describe('a delivery to a host that looks up no more keys this minute', () => {
  it('is answered 429 with Retry-After, whether it held them or not', async () => {
    const limited = { retryAfterSeconds: 17 };
    const { handler: atTheFirst, served } = servedWith({
      holdsKeys: true,
      signingKeys: () => Promise.resolve(limited),
    });
    const { handler: atTheCurrent } = servedWith(holdingThenLimited([otherSecret], limited));

    const answers = [await delivered(atTheFirst), await delivered(atTheCurrent)];

    expect(answers.map(({ status }) => status)).toEqual([429, 429]);
    expect(answers.map(({ headers }) => headers.get('retry-after'))).toEqual(['17', '17']);
    expect(answers[0]?.body).toMatchObject({
      reason: 'too_many_requests',
      detail:
        "The runtime looked up as many connections' keys in this minute as it takes; send this delivery again after the time in Retry-After",
    });
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['lookup_limited']);
  });
});

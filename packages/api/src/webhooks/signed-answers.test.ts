import { webhookSignatureOf } from '@on.auto/identity';
import { rejected } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import {
  answerBody,
  answerPath,
  approvalsId,
  approvalsSecret,
  keyOf,
  notFound,
  nowSeconds,
  otherSecret,
  runId,
  servedWith,
  signedHeaders,
} from '../testing/signed-deliveries.ts';
import { deliveryBounds } from './delivery-bounds.ts';

function delivered(handler: ReturnType<typeof servedWith>['handler'], headers = signedHeaders(), path = answerPath) {
  return call(handler, path, { method: 'POST', headers, body: answerBody });
}

describe('a delivery signed by the connection its address names', () => {
  it('is handed on with its address, its id and its body read as JSON, and answered as the answer was taken', async () => {
    const { handler, served } = servedWith();

    const answer = await delivered(handler);

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ run_id: runId, answer: { verdict: 'approve' } });
    expect(served.answered).toEqual([
      {
        org: 'acme',
        playbook: 'ops',
        connection: 'approvals',
        runId,
        connectionId: approvalsId,
        webhookId: 'msg_2Lh9KRb1t3',
        body: { answer: { verdict: 'approve' }, claimed_for: 'june@acme.example' },
      },
    ]);
    expect(served.heard).toEqual([
      {
        address: { org: 'acme', playbook: 'ops', connection: 'approvals', runId },
        outcome: 'answered',
        status: 200,
        webhookId: 'msg_2Lh9KRb1t3',
        bytes: answerBody.length,
      },
    ]);
  });
});

describe('a delivery signed while its connection changes its secret', () => {
  it('is taken signed with either secret a connection holds while it changes over, or with both in one header', async () => {
    const { handler, served } = servedWith({
      signingKeys: () =>
        Promise.resolve({ connection: approvalsId, keys: [keyOf(otherSecret), keyOf(approvalsSecret)] }),
    });
    const both = signedHeaders({ id: 'msg_both' });
    const withTheOld = webhookSignatureOf(
      keyOf(approvalsSecret),
      'msg_both',
      nowSeconds,
      new TextEncoder().encode(answerBody),
    );
    const withTheNew = webhookSignatureOf(
      keyOf(otherSecret),
      'msg_both',
      nowSeconds,
      new TextEncoder().encode(answerBody),
    );

    const answers = [
      await delivered(handler, signedHeaders({ secret: otherSecret, id: 'msg_new' })),
      await delivered(handler, signedHeaders({ id: 'msg_old' })),
      await delivered(handler, { ...both, 'webhook-signature': `${withTheNew} ${withTheOld}` }),
    ];

    expect(answers.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(served.answered).toHaveLength(3);
  });
});

describe('a delivery to a host that reads the current keys each time', () => {
  it('asks for them once, as they are now', async () => {
    const { handler, served } = servedWith();

    await delivered(handler, signedHeaders({ secret: otherSecret }));

    expect(served.keysAsked).toEqual(['acme/approvals current']);
  });
});

describe('the run a signed delivery names', () => {
  it('is named in lower case, however the address writes it', async () => {
    const { handler, served } = servedWith();

    await delivered(handler, signedHeaders(), answerPath.replace(runId, runId.toUpperCase()));

    expect(served.answered.map((answer) => answer.runId)).toEqual([runId]);
  });

  it('is answered as the answer was refused, a request this connection was not asked among them', async () => {
    const { handler, served } = servedWith({ answered: () => Promise.resolve(notFound) });

    const answer = await delivered(handler);

    expect(answer).toMatchObject({
      status: 404,
      body: { reason: 'not_found', detail: 'There is no request this connection was asked at this address' },
    });
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['refused']);
  });
});

describe('a delivery whose proof does not hold', () => {
  it('is answered the same 401, byte for byte, whatever failed, and no answer is handed on', async () => {
    const { handler, served } = servedWith();
    const unsigned = { 'content-type': 'application/json' };

    const answers = [
      await delivered(handler, unsigned),
      await delivered(handler, signedHeaders({ timestamp: nowSeconds - 301 })),
      await delivered(handler, signedHeaders({ secret: otherSecret })),
      await delivered(handler, signedHeaders(), answerPath.replace('approvals', 'tickets')),
      await delivered(handler, signedHeaders(), answerPath.replace('/acme/', '/Acme Corp/')),
      await delivered(handler, signedHeaders(), answerPath.replace(runId, 'not-a-run')),
      await delivered(handler, signedHeaders({ body: '{"answer":{"verdict":"reject"}}' })),
    ];

    expect(new Set(answers.map(({ status, text }) => `${status} ${text}`))).toEqual(
      new Set([
        '401 {"type":"https://on.auto/problems/unauthenticated","title":"Unauthenticated","status":401,"detail":"The delivery is not signed by the connection its address names","reason":"unauthenticated"}',
      ]),
    );
    expect(served.answered).toEqual([]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual([
      'unsigned',
      'stale',
      'not_signed',
      'unknown',
      'malformed',
      'malformed',
      'not_signed',
    ]);
  });

  it('is refused before the connection is looked up when its headers or its time do not hold', async () => {
    const { handler, served } = servedWith();

    await delivered(handler, { 'content-type': 'application/json' });
    await delivered(handler, signedHeaders({ timestamp: nowSeconds + 301 }));

    expect(served.keysAsked).toEqual([]);
  });
});

describe('a delivery sent again', () => {
  it('is handed on again for the same request, which answers as it answered, and refused at another request', async () => {
    const { handler, served } = servedWith();
    const otherRun = '019a4131-9d2e-7f40-8a51-6b7c8d9e0f13';

    const answers = [
      await delivered(handler),
      await delivered(handler),
      await delivered(handler, signedHeaders(), answerPath.replace(runId, otherRun)),
    ];

    expect(answers.map(({ status }) => status)).toEqual([200, 200, 401]);
    expect(served.answered.map((answer) => answer.runId)).toEqual([runId, runId]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['answered', 'answered', 'replayed']);
  });
});

describe('the deliveries of a connection in a minute', () => {
  it('are taken up to their bound, then answered 429 until the minute ends, and a refused one counts for nothing', async () => {
    const { handler, served } = servedWith({ bounds: { ...deliveryBounds, deliveriesOfAConnectionAMinute: 2 } });

    await delivered(handler, signedHeaders({ secret: otherSecret }));
    const answers = [
      await delivered(handler, signedHeaders({ id: 'msg_1' })),
      await delivered(handler, signedHeaders({ id: 'msg_2' })),
      await delivered(handler, signedHeaders({ id: 'msg_3' })),
    ];

    expect(answers.map(({ status }) => status)).toEqual([200, 200, 429]);
    expect(answers[2]?.headers.get('retry-after')).toBe('60');
    expect(answers[2]?.body).toMatchObject({ reason: 'too_many_requests' });
    expect(served.answered).toHaveLength(2);
  });
});

describe('an answer the runtime cannot take now', () => {
  it('is answered 503 with Retry-After, so the service sends it again', async () => {
    const { handler } = servedWith({
      answered: () => Promise.resolve(rejected('unavailable', 'The playbook cannot take an answer now')),
    });

    const answer = await delivered(handler);

    expect(answer.status).toBe(503);
    expect(answer.headers.get('retry-after')).toBe('5');
  });
});

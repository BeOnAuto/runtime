import { webhookSignatureOf } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import {
  answerBody,
  answerPath,
  approvalsId,
  keyOf,
  nowSeconds,
  otherSecret,
  servedWith,
  signedHeaders,
} from '../testing/signed-deliveries.ts';
import { deliveryBounds } from './delivery-bounds.ts';

function delivered(handler: ReturnType<typeof servedWith>['handler'], headers = signedHeaders(), path = answerPath) {
  return call(handler, path, { method: 'POST', headers, body: answerBody });
}

describe('the body of a delivery', () => {
  it('is refused past 256 KiB as it declares itself, before the connection is looked up', async () => {
    const { handler, served } = servedWith();

    const answer = await call(handler, answerPath, {
      method: 'POST',
      headers: { ...signedHeaders(), 'content-length': String(256 * 1024 + 1) },
      body: answerBody,
    });

    expect(answer).toMatchObject({ status: 413, body: { reason: 'content_too_large' } });
    expect(served.keysAsked).toEqual([]);
  });

  it('is refused past 256 KiB as it arrives, however it declares itself', async () => {
    const { handler } = servedWith();
    const large = JSON.stringify({ answer: 'a'.repeat(256 * 1024) });

    const answer = await call(handler, answerPath, {
      method: 'POST',
      headers: signedHeaders({ body: large }),
      body: large,
    });

    expect(answer).toMatchObject({ status: 413, body: { reason: 'content_too_large' } });
  });
});

describe('a body that arrives late or encoded', () => {
  it('is refused 408 when it does not arrive within the time the runtime waits, and 415 when it is encoded', async () => {
    const { handler } = servedWith({ bounds: { ...deliveryBounds, bodyWaitMs: 20 } });
    const never = new ReadableStream<Uint8Array>({ start: () => {} });

    const slow = await handler.fetch(
      new Request(`http://localhost${answerPath}`, {
        method: 'POST',
        headers: signedHeaders(),
        body: never,
        duplex: 'half',
      }),
    );
    const encoded = await delivered(handler, { ...signedHeaders(), 'content-encoding': 'gzip' });

    expect(slow.status).toBe(408);
    expect(await slow.json()).toMatchObject({
      reason: 'request_timeout',
      detail: 'The body did not arrive within 0.02 seconds',
    });
    expect(encoded).toMatchObject({ status: 415, body: { reason: 'unsupported_media_type' } });
  });
});

describe('a body the door gives up on', () => {
  it('is read no further once it is late, and none past 256 KiB, its stream cancelled', async () => {
    const cancelled: string[] = [];
    const { handler } = servedWith({ bounds: { ...deliveryBounds, bodyWaitMs: 20 } });
    const late = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled.push('late');
      },
    });
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel: () => {
        cancelled.push('too large');
      },
    });
    const posted = (body: ReadableStream<Uint8Array>) =>
      handler.fetch(
        new Request(`http://localhost${answerPath}`, {
          method: 'POST',
          headers: signedHeaders(),
          body,
          duplex: 'half',
        }),
      );

    const answers = [await posted(late), await posted(endless)];

    expect(answers.map(({ status }) => status)).toEqual([408, 413]);
    expect(cancelled).toEqual(['late', 'too large']);
    expect(pulled).toBeLessThan(8);
  });
});

describe('a signed body that is no JSON object', () => {
  it('is read as JSON only once signed, and refused 415 for another media type and 400 for no JSON object', async () => {
    const { handler, served } = servedWith();
    const text = 'approve';
    const list = '["approve"]';
    const asText = { ...signedHeaders({ id: 'msg_text', body: text }), 'content-type': 'text/plain' };
    const { 'content-type': _, ...untyped } = signedHeaders({ id: 'msg_untyped' });

    const answers = [
      await call(handler, answerPath, { method: 'POST', headers: asText, body: text }),
      await call(handler, answerPath, {
        method: 'POST',
        headers: signedHeaders({ id: 'msg_list', body: list }),
        body: list,
      }),
      await call(handler, answerPath, {
        method: 'POST',
        headers: { ...signedHeaders({ id: 'msg_latin' }), 'content-type': 'application/json; charset=latin1' },
        body: answerBody,
      }),
    ];
    const asBytes = await handler.fetch(
      new Request(`http://localhost${answerPath}`, {
        method: 'POST',
        headers: untyped,
        body: new TextEncoder().encode(answerBody),
      }),
    );

    expect([...answers.map(({ status }) => status), asBytes.status]).toEqual([415, 400, 415, 415]);
    expect(served.answered).toEqual([]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual([
      'unreadable',
      'unreadable',
      'unreadable',
      'unreadable',
    ]);
  });
});

describe('signed bytes that are no text', () => {
  it('is refused 400 for bytes that are no UTF-8 text, once signed', async () => {
    const { handler } = servedWith();
    const bytes = Uint8Array.from([0x7b, 0xff, 0x7d]);
    const headers = {
      ...signedHeaders({ id: 'msg_bytes' }),
      'webhook-signature': webhookSignatureOf(keyOf(otherSecret), 'msg_bytes', nowSeconds, bytes),
    };
    const { handler: other } = servedWith({
      signingKeys: () => Promise.resolve({ connection: approvalsId, keys: [keyOf(otherSecret)] }),
    });

    const answer = await other.fetch(
      new Request(`http://localhost${answerPath}`, { method: 'POST', headers, body: bytes }),
    );

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ detail: 'The body could not be read as UTF-8 text' });
    expect(handler).toBeDefined();
  });
});

describe('a signed delivery with no body, or one that breaks off', () => {
  it('hands an empty body on as an object of no fields, and refuses one that breaks off 400, the connection asked nothing', async () => {
    const { handler, served } = servedWith();
    const broken = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.error(new Error('The connection was reset'));
      },
    });

    const empty = await handler.fetch(
      new Request(`http://localhost${answerPath}`, {
        method: 'POST',
        headers: signedHeaders({ id: 'msg_empty', body: '' }),
      }),
    );
    const cut = await handler.fetch(
      new Request(`http://localhost${answerPath}`, {
        method: 'POST',
        headers: signedHeaders(),
        body: broken,
        duplex: 'half',
      }),
    );

    expect(empty.status).toBe(200);
    expect(served.answered.map(({ body }) => body)).toEqual([{}]);
    expect(cut.status).toBe(400);
    expect(await cut.json()).toMatchObject({ detail: 'The body could not be read' });
  });
});

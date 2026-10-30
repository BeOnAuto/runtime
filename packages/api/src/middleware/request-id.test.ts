import { describe, expect, it } from 'vitest';

import { call, echoRequestId, createTestHandler } from '../testing/api-calls.ts';

const uuid = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

describe('the request id', () => {
  it('is a fresh UUID on every response, never the one a client sends', async () => {
    const { handler } = createTestHandler();
    const sent = '00000000-0000-4000-8000-000000000000';

    const first = await call(handler, '/health', { headers: { 'x-request-id': sent } });
    const second = await call(handler, '/nowhere');

    expect(first.headers.get('x-request-id')).toMatch(uuid);
    expect(second.headers.get('x-request-id')).toMatch(uuid);
    expect(first.headers.get('x-request-id')).not.toBe(sent);
    expect(first.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'));
  });

  it('is the one a mounted route reads, along with the caller', async () => {
    const { handler } = createTestHandler({ routes: [echoRequestId] });

    const answer = await call(handler, '/echo');

    expect(answer.body).toEqual({ requestId: answer.headers.get('x-request-id'), caller: 'anyone' });
  });
});

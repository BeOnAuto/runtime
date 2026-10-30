import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { operationServer, type OperationServer } from '../testing/operation-server.ts';

let server: OperationServer;

beforeAll(async () => {
  server = await operationServer();
});

afterAll(async () => {
  await server.runtime.dispose();
});

const publicAnswers = ['/v1/openapi.json', '/v1/guides/notebook', '/.well-known/api-catalog'];

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

async function fetched(path: string, headers: Readonly<Record<string, string>> = {}, method = 'GET'): Promise<Answer> {
  const response = await server.handler.fetch(new Request(`http://localhost${path}`, { method, headers }));
  return { status: response.status, headers: response.headers, text: await response.text() };
}

async function entityTagOf(path: string): Promise<string> {
  return String((await fetched(path)).headers.get('etag'));
}

function cachingOf({ status, headers, text }: Answer): readonly unknown[] {
  return [status, headers.get('etag'), headers.get('cache-control'), text];
}

describe('a public answer', () => {
  it.each(publicAnswers)(
    '%s carries a strong entity tag of its bytes and may be kept for five minutes',
    async (path) => {
      const answer = await fetched(path);

      expect(answer.status).toBe(200);
      expect(answer.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/u);
      expect(answer.headers.get('cache-control')).toBe('public, max-age=300');
      expect((await fetched(path)).headers.get('etag')).toBe(answer.headers.get('etag'));
    },
  );

  it.each(publicAnswers)(
    '%s answers 304 with its tag and no body when If-None-Match names it alone, in a list, as a weak tag or as *',
    async (path) => {
      const etag = await entityTagOf(path);
      const named = [etag, `"stale", ${etag}`, `W/${etag}`, '*'];
      const answers = await Promise.all(named.map((ifNoneMatch) => fetched(path, { 'if-none-match': ifNoneMatch })));

      expect(answers.map((answer) => cachingOf(answer))).toEqual(
        named.map(() => [304, etag, 'public, max-age=300', '']),
      );
    },
  );

  it.each(publicAnswers)('%s answers 200 and its bytes when If-None-Match names another tag', async (path) => {
    const etag = await entityTagOf(path);
    const answers = await Promise.all(
      ['"stale"', 'not a tag'].map((ifNoneMatch) => fetched(path, { 'if-none-match': ifNoneMatch })),
    );

    expect(answers.map(({ status, headers, text }) => [status, headers.get('etag'), text === ''])).toEqual([
      [200, etag, false],
      [200, etag, false],
    ]);
  });
});

describe('HEAD on the document', () => {
  it('answers the headers GET answers, and no body, and 304 when its tag is named', async () => {
    const [got, head] = await Promise.all([fetched('/v1/openapi.json'), fetched('/v1/openapi.json', {}, 'HEAD')]);
    const unchanged = await fetched('/v1/openapi.json', { 'if-none-match': String(got.headers.get('etag')) }, 'HEAD');

    expect(cachingOf(head)).toEqual([200, got.headers.get('etag'), 'public, max-age=300', '']);
    expect(head.headers.get('content-type')).toBe('application/json');
    expect(cachingOf(unchanged)).toEqual([304, got.headers.get('etag'), 'public, max-age=300', '']);
  });
});

describe('HEAD on a guide', () => {
  it('answers the headers GET answers, and no body', async () => {
    const [got, head] = await Promise.all([fetched('/v1/guides/notebook'), fetched('/v1/guides/notebook', {}, 'HEAD')]);

    expect(cachingOf(head)).toEqual([200, got.headers.get('etag'), 'public, max-age=300', '']);
    expect(head.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(got.text).not.toBe('');
  });
});

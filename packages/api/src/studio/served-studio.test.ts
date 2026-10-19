import { authenticatorFor, defaultStudioOrigin } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import type { ApiHandler, ServedStudio, StudioAnswer } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';
import { servedStudio } from '../testing/studios.ts';

const page = '<!doctype html><title>Studio</title><script type="module" src="./assets/index-4f2a9c.js"></script>';

const script = 'export const studio = true;';

const aYear = 31_536_000;

const notes = '/v1/orgs/acme/playbooks/alpha/notes';

function answered(body: string, contentType: string | undefined, freshForSeconds = 0, status = 200): StudioAnswer {
  const bytes = new TextEncoder().encode(body);
  return {
    status,
    contentType,
    body: bytes,
    freshForSeconds,
    etag: undefined,
    lastModified: undefined,
    location: undefined,
  };
}

const validated: StudioAnswer = {
  ...answered('<p>validated</p>', 'text/html'),
  etag: '"p1"',
  lastModified: 'Mon, 19 Oct 2026 08:00:00 GMT',
};

const movedOn: StudioAnswer = {
  ...answered('', undefined, 0, 301),
  location: '/connect/?server=http%3A%2F%2F127.0.0.1',
};

const hostAnswers: ReadonlyMap<string, StudioAnswer> = new Map([
  ['/', answered(page, 'text/html')],
  ['/connect', answered(page, 'text/html')],
  ['/assets/index-4f2a9c.js', answered(script, 'text/javascript', aYear)],
  ['/assets/gone-0d1e2f.js', answered('Not found', 'text/plain', 0, 404)],
  ['/assets/empty-5b6c7d.js', answered('', undefined, 0, 204)],
  ['/validated', validated],
  ['/moved', movedOn],
]);

interface FakeStudio {
  readonly studio: ServedStudio;
  readonly asked: readonly string[];
}

function fakeStudio(): FakeStudio {
  const asked: string[] = [];
  return {
    asked,
    studio: {
      origin: 'https://studio.example.com',
      served: true,
      host: (path) => {
        asked.push(path);
        return Promise.resolve(hostAnswers.get(path));
      },
    },
  };
}

interface Opened {
  readonly status: number;
  readonly type: string | null;
  readonly caching: string | null;
  readonly text: string;
}

async function opened(handler: ApiHandler, path: string, method = 'GET'): Promise<Opened> {
  const response = await handler.fetch(new Request(`http://localhost${path}`, { method }));
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    caching: response.headers.get('cache-control'),
    text: await response.text(),
  };
}

describe('the Studio a runtime serves, at /studio/ and under it', () => {
  it("is the host's page, asked of the host at the same path under its root, without the query", async () => {
    const { studio, asked } = fakeStudio();
    const { handler } = createTestHandler({ studio });

    const root = await opened(handler, '/studio/');
    const route = await opened(handler, '/studio/connect?server=http%3A%2F%2F127.0.0.1%3A5555&token=a-token');

    expect([root, route]).toEqual([
      { status: 200, type: 'text/html', caching: 'no-cache', text: page },
      { status: 200, type: 'text/html', caching: 'no-cache', text: page },
    ]);
    expect(asked).toEqual(['/', '/connect']);
  });

  it('is an asset with its type, which a browser may keep as long as the host keeps it fresh', async () => {
    const { studio } = fakeStudio();
    const { handler } = createTestHandler({ studio });

    expect(await opened(handler, '/studio/assets/index-4f2a9c.js')).toEqual({
      status: 200,
      type: 'text/javascript',
      caching: `public, max-age=${aYear}, immutable`,
      text: script,
    });
  });

  it('carries the status of the host, with no body where the host answered none', async () => {
    const { studio } = fakeStudio();
    const { handler } = createTestHandler({ studio });

    expect([
      await opened(handler, '/studio/assets/gone-0d1e2f.js'),
      await opened(handler, '/studio/assets/empty-5b6c7d.js'),
    ]).toEqual([
      { status: 404, type: 'text/plain', caching: 'no-cache', text: 'Not found' },
      { status: 204, type: null, caching: 'no-cache', text: '' },
    ]);
  });
});

describe('the Studio a runtime serves, asked for in other ways', () => {
  it('is answered to HEAD with the status and the type of GET and no body', async () => {
    const { studio } = fakeStudio();
    const { handler } = createTestHandler({ studio });

    expect(await opened(handler, '/studio/connect', 'HEAD')).toEqual({
      status: 200,
      type: 'text/html',
      caching: 'no-cache',
      text: '',
    });
  });

  it('is a page of its own, with no script, saying where Studio comes from, when the host cannot be reached and nothing was kept', async () => {
    const { handler } = createTestHandler({ studio: servedStudio });

    const answer = await opened(handler, '/studio/settings');

    expect([answer.status, answer.type, answer.caching]).toEqual([503, 'text/html; charset=UTF-8', 'no-store']);
    expect(answer.text).toContain('<h1>Studio cannot be fetched now</h1>');
    expect(answer.text).toContain(`Auto Runtime serves Studio from ${defaultStudioOrigin}, which it cannot reach now`);
    expect(answer.text).not.toContain('<script');
  });
});

describe('what the Studio host says of an answer', () => {
  it('reaches the browser: its validators with the answer, and where it sends the browser on, under /studio/', async () => {
    const { studio } = fakeStudio();
    const { handler } = createTestHandler({ studio });

    const answerWithValidators = await handler.fetch(new Request('http://localhost/studio/validated'));
    const redirect = await handler.fetch(new Request('http://localhost/studio/moved'));

    expect([answerWithValidators.headers.get('etag'), answerWithValidators.headers.get('last-modified')]).toEqual([
      '"p1"',
      'Mon, 19 Oct 2026 08:00:00 GMT',
    ]);
    expect([redirect.status, redirect.headers.get('location')]).toEqual([
      301,
      '/studio/connect/?server=http%3A%2F%2F127.0.0.1',
    ]);
  });
});

describe('a request to the Studio a runtime serves', () => {
  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])(
    'is refused with 405 for %s, naming GET and HEAD, and the host is asked nothing',
    async (method) => {
      const { studio, asked } = fakeStudio();
      const { handler } = createTestHandler({ studio });

      const answer = await call(handler, '/studio/connect', { method });

      expect(answer).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
      expect(answer.headers.get('allow')).toBe('GET, HEAD');
      expect(asked).toEqual([]);
    },
  );

  it.each(['/studio/..%2Fv1%2Forgs', '/studio/assets/.%2E%2Fhealth', '/studio/%2e%2E%2fhealth', '/studio/a..b'])(
    'is refused with 404 at %s, which leaves /studio/ or holds .., and the host is asked nothing',
    async (path) => {
      const { studio, asked } = fakeStudio();
      const { handler } = createTestHandler({ studio });

      expect(await call(handler, path)).toMatchObject({ status: 404, body: { reason: 'not_found' } });
      expect(asked).toEqual([]);
    },
  );
});

describe('/studio, without its final slash', () => {
  it('is sent on to /studio/ with its query, since the page resolves its files against its folder, and the host is asked nothing', async () => {
    const { studio, asked } = fakeStudio();
    const { handler } = createTestHandler({ studio });

    const answer = await handler.fetch(new Request('http://localhost/studio?server=http%3A%2F%2F127.0.0.1%3A5555'));

    expect([answer.status, answer.headers.get('location')]).toEqual([
      308,
      '/studio/?server=http%3A%2F%2F127.0.0.1%3A5555',
    ]);
    expect(asked).toEqual([]);
  });
});

describe('the Studio a runtime that takes keys serves', () => {
  it('needs no key, at /studio/ nor at /studio, while every other path still does', async () => {
    const { studio } = fakeStudio();
    const { handler } = await operationServer({ studio });

    expect([
      (await opened(handler, '/studio/')).status,
      (await opened(handler, '/studio')).status,
      (await call(handler, notes)).status,
      (await call(handler, notes, { headers: { authorization: `Bearer ${acmeAdmin.key}` } })).status,
    ]).toEqual([200, 308, 401, 200]);
  });
});

describe('a runtime that serves no Studio', () => {
  it('has no route at /studio/, and asks for a key there as everywhere where it takes keys', async () => {
    const { handler } = await operationServer();

    expect([
      (await call(createTestHandler().handler, '/studio/')).status,
      (await call(handler, '/studio/')).status,
    ]).toEqual([404, 401]);
  });
});

const refusedInLocalMode: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['a Host that is not a localhost name', { host: 'studio.evil.example' }],
  ['a page of another origin', { host: 'localhost:5555', origin: 'https://evil.example' }],
];

describe('the Studio a runtime in local mode serves', () => {
  it.each(refusedInLocalMode)('refuses %s with 403 before the host is asked', async (_case, headers) => {
    const { studio, asked } = fakeStudio();
    const authenticator = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });
    const { handler } = createTestHandler({ studio, authenticator });

    expect((await call(handler, '/studio/', { headers })).status).toBe(403);
    expect(asked).toEqual([]);
  });
});

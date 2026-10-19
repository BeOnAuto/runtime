import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ApiHandler, ServedStudio, StudioAnswer } from '../index.ts';
import { createTestHandler } from '../testing/api-calls.ts';

function policyAllowing(...scripts: readonly string[]): string {
  return [
    "default-src 'none'",
    [
      "script-src 'self'",
      ...scripts.map((script) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`),
    ].join(' '),
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const apiPolicy = "default-src 'none'; frame-ancestors 'none'";

const reloadOnce = "addEventListener('error', () => location.reload());";

const startStudio = 'startStudio();';

const pageWithScripts = `<!doctype html><head><script>${reloadOnce}</script><script type="module">${startStudio}</script><script type="module" src="./assets/index-4f2a9c.js"></script></head>`;

function answered(text: string, contentType: string): StudioAnswer {
  const body = new TextEncoder().encode(text);
  return {
    status: 200,
    contentType,
    body,
    freshForSeconds: 0,
    etag: undefined,
    lastModified: undefined,
    location: undefined,
  };
}

const hostAnswers: ReadonlyMap<string, StudioAnswer> = new Map([
  ['/', answered('<!doctype html><title>Studio</title>', 'text/html')],
  ['/connect', answered(pageWithScripts, 'text/html; charset=utf-8')],
  ['/assets/index-4f2a9c.js', answered(`document.write('<script>${startStudio}</script>');`, 'text/javascript')],
]);

const studio: ServedStudio = {
  origin: 'https://studio.example.com',
  served: true,
  host: (path) => Promise.resolve(hostAnswers.get(path)),
};

async function headersAt(handler: ApiHandler, path: string): Promise<Readonly<Record<string, string>>> {
  const response = await handler.fetch(new Request(`http://localhost${path}`));
  await response.body?.cancel();
  const {
    'content-type': _type,
    'content-length': _length,
    'cache-control': _caching,
    'x-request-id': _id,
    location: _location,
    ...security
  } = Object.fromEntries(response.headers);
  return security;
}

function policiesAt(handler: ApiHandler, paths: readonly string[]): Promise<readonly (string | undefined)[]> {
  return Promise.all(paths.map(async (path) => (await headersAt(handler, path))['content-security-policy']));
}

describe('the security headers of a runtime that serves Studio', () => {
  it('give every answer under /studio/ a policy that lets the page load its scripts, workers, styles, fonts and images from this origin, write styles of its own, and call this origin alone', async () => {
    const { handler } = createTestHandler({ studio });

    expect(
      await policiesAt(handler, ['/studio/', '/studio/unreachable', '/studio', '/studio/assets/index-4f2a9c.js']),
    ).toEqual([policyAllowing(), policyAllowing(), policyAllowing(), policyAllowing()]);
  });

  it("allow the inline scripts of the host's page by their hashes, read from the page the host answers, and those alone", async () => {
    const { handler } = createTestHandler({ studio });

    expect(await policiesAt(handler, ['/studio/connect'])).toEqual([policyAllowing(reloadOnce, startStudio)]);
  });

  it("keep the API's policy on every other path, and the same other security headers under /studio/ as there", async () => {
    const { handler } = createTestHandler({ studio });

    const { 'content-security-policy': underStudio, ...studioHeaders } = await headersAt(handler, '/studio/');
    const { 'content-security-policy': elsewhere, ...apiHeaders } = await headersAt(handler, '/nowhere');

    expect([underStudio, elsewhere]).toEqual([policyAllowing(), apiPolicy]);
    expect(studioHeaders).toEqual(apiHeaders);
    expect(apiHeaders).toMatchObject({
      'x-frame-options': 'DENY',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    });
  });
});

describe('the security headers of a runtime that serves no Studio', () => {
  it("are the API's under /studio/ as everywhere", async () => {
    expect(await policiesAt(createTestHandler().handler, ['/studio/', '/studio'])).toEqual([apiPolicy, apiPolicy]);
  });
});

import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  debugPageServer,
  debugServing,
  debugStyleOnDisk,
  idsIn,
  type DebugPageServer,
} from '../testing/debug-pages.ts';
import { acmeAdmin } from '../testing/operation-server.ts';
import { debugPageAnswerOf } from './debug-routes.ts';

let served: DebugPageServer;

beforeAll(async () => {
  served = await debugPageServer();
});

afterAll(async () => {
  await served.close();
});

function hashOf(element: string): string {
  const inside = new RegExp(`<${element}>([\\s\\S]*?)</${element}>`, 'u').exec(served.page.text)?.[1] ?? '';
  return `'sha256-${createHash('sha256').update(inside).digest('base64')}'`;
}

describe('the page at /debug', () => {
  it('answers a caller with no key with one HTML document', () => {
    const { status, headers, text } = served.page;
    expect([status, headers.get('content-type')]).toEqual([200, 'text/html; charset=UTF-8']);
    expect(text.startsWith('<!doctype html>')).toBe(true);
  });

  it('allows only its own script and style, by their hashes', () => {
    const policy = String(served.page.headers.get('content-security-policy'));
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(`script-src ${hashOf('script')}`);
    expect(policy).toContain(`style-src ${hashOf('style')}`);
    expect(served.page.headers.get('cache-control')).toBe('no-store');
  });

  it('renders each guide of a shelf once, in its order, beside its raw Markdown', () => {
    const { text } = served.page;
    expect(idsIn(text, '', 'guide')).toEqual(['notebook', 'take-a-note', 'terminology']);
    expect(text.indexOf('id="guide-terminology"')).toBeLessThan(text.indexOf('id="guide-notebook"'));
    expect(text).toContain('<h1>Notebook</h1>');
    expect(text).toContain('<pre class="verbatim"># Notebook\n\nA note has a name');
    expect(text).toContain('href="#org-guide-notebook"');
  });

  it('gives the directory listing its own shelf, without the guides it lacks', () => {
    expect(idsIn(served.page.text, 'directory-', 'guide')).toEqual(['notebook', 'take-a-note']);
    expect(served.page.text).toContain('href="#directory-guide-notebook"');
    expect(served.page.text).not.toContain('#directory-guide-terminology');
  });

  it('answers 404 under /debug once the caller is known, as on any other path', async () => {
    const authorized = { authorization: `Bearer ${acmeAdmin.key}` };
    const answers = [await served.fetched('/debug/tools', authorized), await served.fetched('/debug/tools')];
    expect(answers.map(({ status }) => status)).toEqual([404, 401]);
  });
});

describe('the page at /debug, for a server that answers it without these routes', () => {
  it('is the same document, with the same headers', async () => {
    const { html, headers } = await debugPageAnswerOf(debugServing, await debugStyleOnDisk());
    expect(html).toBe(served.page.text);
    expect(
      Object.entries(headers).filter(
        ([name, value]: readonly [string, string]) => served.page.headers.get(name) !== value,
      ),
    ).toEqual([]);
    expect(headers['content-security-policy']).toContain("default-src 'none'");
  });
});

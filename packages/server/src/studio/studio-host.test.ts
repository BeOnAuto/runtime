import { describe, expect, it } from 'vitest';

import {
  answered,
  bytesOf,
  memoryKept,
  modified,
  page,
  scriptedHost,
  scriptedOrigin as origin,
  textOf,
  unreachable,
} from '../testing/studios/scripted-studio-host.ts';

describe('an asset the Studio host marks immutable', () => {
  it('is fetched once and answered from what was kept while the host says it is fresh, and fetched again after', async () => {
    const host = scriptedHost(
      () =>
        new Response(bytesOf('export {};'), {
          headers: { 'cache-control': 'public, max-age=60, immutable', age: '10' },
        }),
    );

    const first = await host.ask('/assets/index-4f2a9c.js');
    host.passSeconds(20);
    const second = await host.ask('/assets/index-4f2a9c.js');
    host.passSeconds(31);
    const third = await host.ask('/assets/index-4f2a9c.js');

    expect(
      [first, second, third].map((answer) => [answer?.status, answer?.contentType, answer?.freshForSeconds]),
    ).toEqual([
      [200, undefined, 50],
      [200, undefined, 30],
      [200, undefined, 50],
    ]);
    expect(host.asked()).toHaveLength(2);
  });

  it.each([
    ['without a max-age', { 'cache-control': 'immutable' }],
    ['with a max-age that is no number', { 'cache-control': 'immutable, max-age=soon' }],
    ['without a word of caching', {}],
  ])('is asked again on every request %s', async (_case, headers: Readonly<Record<string, string>>) => {
    const host = scriptedHost(() => new Response(bytesOf('export {};'), { headers }));

    await host.ask('/assets/index-4f2a9c.js');
    const again = await host.ask('/assets/index-4f2a9c.js');

    expect([again?.freshForSeconds, host.asked().length]).toEqual([0, 2]);
  });
});

describe('an asset the Studio host says has not changed', () => {
  it('is fresh again for as long as a 304 of the host says, with the validators it carries', async () => {
    const host = scriptedHost(
      () =>
        new Response(bytesOf('export {};'), { headers: { 'cache-control': 'max-age=60, immutable', etag: '"a1"' } }),
    );

    await host.ask('/assets/index-4f2a9c.js');
    host.passSeconds(61);
    host.answerWith(answered(304, { 'cache-control': 'max-age=60, immutable', etag: '"a2"' }));
    const renewed = await host.ask('/assets/index-4f2a9c.js');
    host.passSeconds(30);
    const kept = await host.ask('/assets/index-4f2a9c.js');

    expect([renewed?.freshForSeconds, renewed?.etag, kept?.freshForSeconds, textOf(kept)]).toEqual([
      60,
      '"a2"',
      30,
      'export {};',
    ]);
    expect(host.asked().map(({ validators }) => validators[0])).toEqual([null, '"a1"']);
  });
});

describe("Studio's page", () => {
  it("is asked of the host on every request with the host's validators, which its answer carries, and answered as kept when the host says it has not changed", async () => {
    const host = scriptedHost(page('<p>first</p>', '"p1"'));

    const first = await host.ask('/connect');
    host.answerWith(answered(304));
    const unchanged = await host.ask('/connect');
    host.answerWith(page('<p>second</p>', '"p2"'));
    const changed = await host.ask('/connect');
    await host.ask('/connect');

    expect([first, unchanged, changed].map((answer) => [answer?.contentType, textOf(answer), answer?.etag])).toEqual([
      ['text/html', '<p>first</p>', '"p1"'],
      ['text/html', '<p>first</p>', '"p1"'],
      ['text/html', '<p>second</p>', '"p2"'],
    ]);
    expect(first?.lastModified).toBe(modified);
    expect(host.asked().map(({ validators }) => validators)).toEqual([
      [null, null],
      ['"p1"', modified],
      ['"p1"', modified],
      ['"p2"', modified],
    ]);
  });

  it('is answered as kept when the host cannot be reached, and not at all when nothing was kept', async () => {
    const host = scriptedHost(unreachable);

    const nothingKept = await host.ask('/');
    host.answerWith(page('<p>kept</p>', '"p1"'));
    await host.ask('/');
    host.answerWith(unreachable);
    const kept = await host.ask('/');

    expect([nothingKept, textOf(kept), kept?.status]).toEqual([undefined, '<p>kept</p>', 200]);
  });
});

describe("Studio's page, as kept", () => {
  it('is kept once for every route and for every file the host answers with it, so a route never asked before is answered with it while the host cannot be reached', async () => {
    const kept = memoryKept();
    const host = scriptedHost(page('<p>the page</p>', '"p1"'), { kept });

    await host.ask('/connect');
    await host.ask('/assets/missing-0a1b2c.js');
    host.answerWith(unreachable);
    const route = await host.ask('/settings');

    expect(textOf(route)).toBe('<p>the page</p>');
    expect(
      await Promise.all(
        [`${origin}/`, `${origin}/connect`, `${origin}/settings`, `${origin}/assets/missing-0a1b2c.js`].map(
          async (key) => (await kept.answerAt(key))?.key,
        ),
      ),
    ).toEqual([`${origin}/`, undefined, undefined, undefined]);
  });

  it('kept from one Studio host is never answered for another', async () => {
    const kept = memoryKept();
    await scriptedHost(page('<p>the first host</p>', '"p1"'), { kept }).ask('/');

    expect(
      await scriptedHost(unreachable, { kept, hostOrigin: 'https://studio.example.org' }).ask('/'),
    ).toBeUndefined();
  });
});

import { toolBounds } from '@on.auto/tool-servers';
import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { answered, bytesOf, page, scriptedHost, textOf, unreachable } from '../testing/studios/scripted-studio-host.ts';
import { studioBounds } from './studio-host.ts';

describe('what the Studio host answers but a page or an asset to keep', () => {
  it('is passed on with its status and type, and kept neither when it is not 200 nor when the host says not to store it', async () => {
    const host = scriptedHost(
      () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
    );

    const missing = await host.ask('/assets/gone.js');
    host.answerWith(() => new Response(bytesOf('<p>private</p>'), { headers: { 'cache-control': 'no-store' } }));
    const unstored = await host.ask('/private.json');
    host.answerWith(unreachable);
    const afterwards = await Promise.all(['/assets/gone.js', '/private.json'].map((path) => host.ask(path)));

    expect([missing, unstored].map((answer) => [answer?.status, answer?.contentType, textOf(answer)])).toEqual([
      [404, 'text/plain', 'Not found'],
      [200, undefined, '<p>private</p>'],
    ]);
    expect(afterwards).toEqual([undefined, undefined]);
  });

  it('is taken as a host that cannot be reached when it is a 304 for nothing kept, or a 5xx while a copy is kept', async () => {
    const host = scriptedHost(answered(304));

    const unasked = await host.ask('/assets/never-kept.js');
    host.answerWith(answered(503));
    const failing = await host.ask('/');
    host.answerWith(page('<p>kept</p>', '"p1"'));
    await host.ask('/');
    host.answerWith(answered(502));
    const hidden = await host.ask('/');

    expect([unasked, failing?.status, hidden?.status, textOf(hidden)]).toEqual([undefined, 503, 200, '<p>kept</p>']);
  });
});

describe('a redirect of the Studio host', () => {
  it.each([
    ['an address on the host', 'https://studio.example.com/connect/?step=1', '/connect/?step=1'],
    ['a path', '/connect/', '/connect/'],
    ['a path relative to the one asked', 'next', '/flow/next'],
  ])('to %s sends the browser to the same path under /studio/', async (_case, location, path) => {
    const host = scriptedHost(answered(302, { location }));

    expect(await host.ask('/flow/start')).toMatchObject({ status: 302, location: path });
  });

  it.each([
    ['to another host', { location: 'https://elsewhere.example/connect' }],
    ['to nowhere', {}],
  ])(
    '%s is taken as a host that cannot be reached, answering the kept copy or nothing',
    async (_case, headers: Readonly<Record<string, string>>) => {
      const host = scriptedHost(answered(301, headers));

      const nothingKept = await host.ask('/connect');
      host.answerWith(page('<p>kept</p>', '"p1"'));
      await host.ask('/connect');
      host.answerWith(answered(301, headers));
      const kept = await host.ask('/connect');

      expect([nothingKept, kept?.status, textOf(kept)]).toEqual([undefined, 200, '<p>kept</p>']);
    },
  );
});

describe('a request to the Studio host', () => {
  it('is bounded as a call is, in time and in the bytes of its answer', () => {
    expect(studioBounds).toEqual({ answerMs: toolBounds.callMs, answerBytes: toolBounds.httpAnswerBytes });
  });

  it('whose answer passes the bound of its bytes is taken as one the host could not give', async () => {
    const host = scriptedHost(() => new Response('123456789'), { bounds: { ...studioBounds, answerBytes: 8 } });

    expect(await host.ask('/assets/large.js')).toBeUndefined();
  });

  it('that is not answered within the bound of its time is taken as one the host could not give', async () => {
    const host = scriptedHost(() => new Promise<Response>(Function.constVoid), {
      bounds: { ...studioBounds, answerMs: 50 },
    });

    expect(await host.ask('/assets/slow.js')).toBeUndefined();
  });
});

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ApiHandler } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';
import { operationServer } from '../testing/operation-server.ts';
import { servedStudio } from '../testing/studios.ts';

const fromABrowser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

function open(handler: ApiHandler, address = 'http://localhost:5555/'): Promise<Response> {
  return handler.fetch(new Request(address, { headers: fromABrowser }));
}

function styleOf(page: string): string {
  return page.slice(page.indexOf('<style>') + '<style>'.length, page.indexOf('</style>'));
}

describe('the root of the server, opened in a browser', () => {
  it('is a page that says the server is running', async () => {
    const response = await open(createTestHandler().handler);

    expect({ status: response.status, type: response.headers.get('content-type') }).toEqual({
      status: 200,
      type: 'text/html; charset=UTF-8',
    });
    expect(await response.text()).toContain('<h1>Auto Runtime is running</h1>');
  });

  it('shows the address the server answers at', async () => {
    const page = await (await open(createTestHandler().handler, 'http://127.0.0.1:9090/')).text();

    expect(page).toContain('<span class="address">127.0.0.1:9090</span>');
  });

  it('is served without a key', async () => {
    const { handler } = await operationServer();

    expect((await open(handler)).status).toBe(200);
  });
});

describe('the studio the page at the root of the server opens', () => {
  it('opens the studio on this server, from this page', async () => {
    const page = await (await open(createTestHandler().handler)).text();

    expect(page).toContain('href="https://studio.on.auto/?server=http%3A%2F%2Flocalhost%3A5555&amp;src=runtime-page"');
  });

  it('opens the Studio this server serves, where it serves one', async () => {
    const page = await (await open(createTestHandler({ studio: servedStudio }).handler)).text();

    expect(page).toContain(
      'href="http://localhost:5555/studio/?server=http%3A%2F%2Flocalhost%3A5555&amp;src=runtime-page"',
    );
  });

  it('names the install of this server in the studio it opens, once the server has one', async () => {
    const install: { id: string | undefined } = { id: undefined };
    const { handler } = createTestHandler({ installId: () => install.id });

    const before = await (await open(handler)).text();
    install.id = '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b';
    const after = await (await open(handler)).text();

    expect(before).toContain('?server=http%3A%2F%2Flocalhost%3A5555&amp;src=runtime-page"');
    expect(after).toContain(
      '?server=http%3A%2F%2Flocalhost%3A5555&amp;src=runtime-page&amp;install=6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b"',
    );
  });
});

function iconFor(page: string, scheme: string): string {
  const link = new RegExp(
    `<link rel="icon" href="data:image/svg\\+xml;base64,([^"]+)" media="\\(prefers-color-scheme: ${scheme}\\)"`,
    'u',
  );
  return Buffer.from(link.exec(page)?.[1] ?? '', 'base64').toString();
}

function tileOf(icon: string): string | undefined {
  return /<path d="M512\.644 100H[^"]+" fill="([^"]+)"/u.exec(icon)?.[1];
}

const colorBands = ['#EC3F4A', '#FF8A1D', '#5EC72D', '#42C3F7'];

function colorsBehindTheTileOf(drawing: string): readonly string[] {
  const behind = drawing.slice(0, drawing.indexOf('M512.644 100H'));
  return [...behind.matchAll(/fill="([^"]+)"/gu)].map(([, color = '']: readonly string[]) => color);
}

describe('the icon of the page at the root of the server', () => {
  it('is the Auto mark, dark on a light browser and light on a dark one', async () => {
    const page = await (await open(createTestHandler().handler)).text();

    expect({ onLight: tileOf(iconFor(page, 'light')), onDark: tileOf(iconFor(page, 'dark')) }).toEqual({
      onLight: '#1A1A1A',
      onDark: '#FFFFFF',
    });
  });

  it('is the same drawing in both, with ink and paper swapped', async () => {
    const page = await (await open(createTestHandler().handler)).text();
    const swapped = iconFor(page, 'light')
      .replaceAll('#1A1A1A', 'ink')
      .replaceAll('#FFFFFF', '#1A1A1A')
      .replaceAll('ink', '#FFFFFF');

    expect(iconFor(page, 'dark')).toBe(swapped);
  });

  it('draws the four color bands of the Auto mark behind the tile, in both', async () => {
    const page = await (await open(createTestHandler().handler)).text();

    expect({
      onLight: colorsBehindTheTileOf(iconFor(page, 'light')),
      onDark: colorsBehindTheTileOf(iconFor(page, 'dark')),
    }).toEqual({ onLight: colorBands, onDark: colorBands });
  });
});

function brandOf(page: string): string {
  return /<span class="brand">.*?<\/span><\/span>/su.exec(page)?.[0] ?? '';
}

describe('the brand at the head of the page at the root of the server', () => {
  it('is the Auto mark, with its four color bands behind the tile', async () => {
    const page = await (await open(createTestHandler().handler)).text();

    expect(colorsBehindTheTileOf(brandOf(page))).toEqual(colorBands);
  });

  it('names Auto beside the mark', async () => {
    const page = await (await open(createTestHandler().handler)).text();

    expect(brandOf(page)).toMatch(/<\/svg><span class="name">Auto<\/span><\/span>$/u);
  });
});

function fontsOf(page: string): readonly string[] {
  const embedded = page.match(/data:font\/woff2;base64,[^)]+/gu) ?? [];
  return embedded.map((font) =>
    Buffer.from(font.slice(font.indexOf(',') + 1), 'base64')
      .subarray(0, 4)
      .toString('latin1'),
  );
}

describe('what the page at the root of the server loads', () => {
  it('carries its two typefaces itself, as WOFF2', async () => {
    const page = await (await open(createTestHandler().handler)).text();

    expect(fontsOf(page)).toEqual(['wOF2', 'wOF2']);
    expect(page).toContain("font-family: 'DM Mono';");
    expect(page).toContain("font-family: 'DM Sans';");
  });

  it('names no other server than the studio it opens', async () => {
    const page = await (await open(createTestHandler().handler)).text();

    expect(page.match(/https?:\/\/[^"')\s]+/gu)).toEqual([
      'https://studio.on.auto/?server=http%3A%2F%2Flocalhost%3A5555&amp;src=runtime-page',
    ]);
  });
});

describe('the page at the root of the server', () => {
  it('may run no script and load nothing but what it carries', async () => {
    const response = await open(createTestHandler().handler);
    const ownStyles = createHash('sha256')
      .update(styleOf(await response.text()))
      .digest('base64');

    expect(response.headers.get('content-security-policy')).toBe(
      `default-src 'none'; style-src 'sha256-${ownStyles}'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
  });

  it('may not be framed, sniffed or cached, and sends no referrer', async () => {
    const { headers } = await open(createTestHandler().handler);

    expect({
      frameOptions: headers.get('x-frame-options'),
      contentTypeOptions: headers.get('x-content-type-options'),
      cacheControl: headers.get('cache-control'),
      referrerPolicy: headers.get('referrer-policy'),
    }).toEqual({
      frameOptions: 'DENY',
      contentTypeOptions: 'nosniff',
      cacheControl: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });
});

describe('the root of the server, for anything but a browser opening it', () => {
  it.each<Readonly<Record<string, string>>>([{}, { accept: 'application/json' }, { accept: '*/*' }])(
    'has no route for a client that accepts %j',
    async (headers: Readonly<Record<string, string>>) => {
      expect(await call(createTestHandler().handler, '/', { headers })).toMatchObject({
        status: 404,
        body: { reason: 'not_found' },
      });
    },
  );

  it('has no route for another method', async () => {
    expect(await call(createTestHandler().handler, '/', { method: 'POST', headers: fromABrowser })).toMatchObject({
      status: 404,
      body: { reason: 'not_found' },
    });
  });

  it('is the only path with a page', async () => {
    expect(await call(createTestHandler().handler, '/nowhere', { headers: fromABrowser })).toMatchObject({
      status: 404,
      body: { reason: 'not_found' },
    });
  });
});

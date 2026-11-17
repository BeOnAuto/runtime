import { Buffer } from 'node:buffer';

import { assetContentOf, assetUnusable, type AssetUnusable, type HeldAsset } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { base64Bytes, bytesRead, encodedAs } from './encoded-pieces.ts';
import type { SentAsset } from './planned-assets.ts';
import { argumentsSent, sendingWith, splicedBody, splicesInFlight, splicingFetch } from './spliced-bodies.ts';

type Opening = () => Effect.Effect<ReadableStream<Uint8Array>, AssetUnusable>;

function piecesOf(bytes: Readonly<Uint8Array>, cut: number): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull: (controller: Readonly<ReadableStreamDefaultController<Uint8Array>>) => {
      if (at >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + cut));
      at += cut;
    },
  });
}

function textOf(stream: ReadableStream<Uint8Array> | undefined): Promise<string> {
  return new Response(stream).text();
}

function heldOf(content: string, mediaType: string, opened?: Opening): HeldAsset {
  const bytes = Buffer.from(content);
  return {
    id: 'asset-1',
    mediaType,
    bytes: bytes.byteLength,
    sha256: 'a'.repeat(64),
    content: assetContentOf(mediaType),
    opened: opened ?? (() => Effect.succeed(piecesOf(bytes, 5))),
  };
}

function sentOf(pointer: string, encoding: SentAsset['encoding'], held: HeldAsset): SentAsset {
  const [first = '', ...rest] = pointer.split('/').slice(1);
  return { pointer, place: [first, ...rest], encoding, bytes: 0, held };
}

function endlessUntil(cancelled: (reason: unknown) => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull: (controller: Readonly<ReadableStreamDefaultController<Uint8Array>>) => {
      controller.enqueue(Buffer.from('word '));
    },
    cancel: cancelled,
  });
}

async function nextTextOf(reader: Readonly<ReadableStreamDefaultReader<Uint8Array>>): Promise<string> {
  const { value } = await reader.read();
  return Buffer.from(value ?? []).toString();
}

async function firstTwoOf(body: ReadableStream<Uint8Array> | null): Promise<readonly string[]> {
  const reader = body?.getReader();
  if (reader === undefined) {
    return [];
  }
  const read = [await nextTextOf(reader), await nextTextOf(reader)];
  await reader.cancel('stopped');
  return read;
}

describe('the pieces an asset is written in', () => {
  it('writes text as a JSON string, escaping each piece alone, a character cut across two pieces among them', async () => {
    const text = 'Café “menu” 😀\n\t"quoted" \\ \u0001 end';
    const bytes = Buffer.from(text);

    const written = await Promise.all(
      [1, 2, 3, 5, bytes.byteLength].map((cut) => textOf(encodedAs('text', piecesOf(bytes, cut)))),
    );

    expect(new Set(written)).toEqual(new Set([JSON.stringify(text)]));
    expect(await bytesRead(encodedAs('text', piecesOf(bytes, 4)))).toBe(Buffer.byteLength(JSON.stringify(text)));
    expect(await textOf(encodedAs('text', piecesOf(Buffer.from([0x41, 0xff, 0x42]), 1)))).toBe('"A�B"');
  });

  it('writes a file as the base64 of its bytes whatever its pieces are cut at, in as many bytes as it says', async () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, at) => (at * 7) % 256);

    const written = await Promise.all(
      [1, 2, 3, 4, 7, 1000].map((cut) => textOf(encodedAs('base64', piecesOf(bytes, cut)))),
    );

    expect(new Set(written)).toEqual(new Set([JSON.stringify(Buffer.from(bytes).toString('base64'))]));
    expect([0, 1, 2, 3, 1000].map((count) => base64Bytes(count))).toEqual([2, 6, 6, 6, 1338]);
  });

  it('writes JSON as the bytes it holds', async () => {
    expect(await textOf(encodedAs('json', piecesOf(Buffer.from('[1, {"a": 2}]'), 3)))).toBe('[1, {"a": 2}]');
  });
});

describe('a request’s body with an asset in it', () => {
  it('holds a token where each asset is, and writes the asset in its place, a piece at a time', async () => {
    const page = sentOf('/content', 'text', heldOf('# Menu\n', 'text/markdown'));
    const rows = sentOf('/rows/1', 'json', heldOf('[{"a":1}]', 'application/json'));
    const nested = sentOf('/meta/cover', 'base64', heldOf('ab', 'image/png'));
    const input = { path: 'm.md', content: { id: 'asset-1' }, rows: [1, { id: 'asset-2' }, 3], meta: { cover: {} } };

    const sent = argumentsSent(input, [page, rows, nested]);
    const [first, second, third] = sent.splices.keys();
    const body = splicedBody(JSON.stringify({ arguments: sent.input }), sent.splices);

    expect(sent.input).toEqual({ path: 'm.md', content: first, rows: [1, second, 3], meta: { cover: third } });
    expect(input.content).toEqual({ id: 'asset-1' });
    expect(await textOf(body?.stream)).toBe(
      '{"arguments":{"path":"m.md","content":"# Menu\\n","rows":[1,[{"a":1}],3],"meta":{"cover":"YWI="}}}',
    );
  });

  it('is left as it is where no token is in it, and every body writes the asset afresh', async () => {
    const sent = argumentsSent({ content: {} }, [sentOf('/content', 'text', heldOf('one', 'text/plain'))]);
    const text = JSON.stringify(sent.input);

    expect(splicedBody('{"other":"call"}', sent.splices)).toBe(undefined);
    expect([
      await textOf(splicedBody(text, sent.splices)?.stream),
      await textOf(splicedBody(text, sent.splices)?.stream),
    ]).toEqual(['{"content":"one"}', '{"content":"one"}']);
  });
});

describe('a request’s body as it is read', () => {
  it('lets go of the asset it is reading when its reader stops', async () => {
    const cancelled: unknown[] = [];
    const endless = heldOf('', 'application/json', () =>
      Effect.succeed(
        endlessUntil((reason) => {
          cancelled.push(reason);
        }),
      ),
    );
    const sent = argumentsSent({ content: {} }, [sentOf('/content', 'json', endless)]);
    const reader = new Response(splicedBody(JSON.stringify(sent.input), sent.splices)?.stream).body;

    const read = await firstTwoOf(reader);

    expect([read, cancelled]).toEqual([['{"content":', 'word '], ['stopped']]);
  });

  it('fails as it is read where the asset’s content is no longer kept, with the words why', async () => {
    const gone = heldOf('x', 'text/plain', () =>
      Effect.fail(assetUnusable('content_gone', { id: 'asset-1', sha256: 'a'.repeat(64) })),
    );
    const sent = argumentsSent({ content: {} }, [sentOf('/content', 'text', gone)]);

    await expect(textOf(splicedBody(JSON.stringify(sent.input), sent.splices)?.stream)).rejects.toThrow(
      'The content of the asset asset-1 is no longer kept',
    );
  });
});

describe('a request’s body as a fetch sends it', () => {
  it('takes as many bytes as it writes, which a fetch sends as the length of its request', async () => {
    const page = { ...sentOf('/content', 'text', heldOf('Café\n', 'text/plain')), bytes: 9 };
    const file = { ...sentOf('/file', 'base64', heldOf('abcd', 'image/png')), bytes: base64Bytes(4) };
    const sent = argumentsSent({ content: {}, file: {} }, [page, file]);
    const written = Buffer.byteLength(JSON.stringify({ content: 'Café\n', file: 'YWJjZA==' }));
    const seen: unknown[] = [];
    const fetched = splicingFetch(async (...[, init]: readonly [unknown, unknown?]) => {
      const asked: RequestInit = Object.assign({}, init);
      seen.push(
        new Headers(asked.headers).get('content-length'),
        Buffer.byteLength(await new Response(asked.body).text()),
      );
      return new Response('ok');
    });

    await sendingWith(sent.splices, () =>
      fetched('https://tools.example', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sent.input),
      }),
    );

    expect([splicedBody(JSON.stringify(sent.input), sent.splices)?.length, seen]).toEqual([
      written,
      [String(written), written],
    ]);
  });

  it('is written by a fetch only within the sending of the call that holds it, as a stream sent half-duplex', async () => {
    const sent = argumentsSent({ content: {} }, [sentOf('/content', 'text', heldOf('menu', 'text/plain'))]);
    const seen: unknown[] = [];
    const fetched = splicingFetch((...[, init]: readonly [unknown, unknown?]) => {
      const asked: RequestInit = Object.assign({}, init);
      seen.push(asked.body, asked.duplex);
      return Promise.resolve(new Response('ok'));
    });
    const body = JSON.stringify(sent.input);

    await fetched('https://tools.example', { method: 'POST', body });
    await sendingWith(sent.splices, () => fetched('https://tools.example', { method: 'POST', body }));
    await sendingWith(sent.splices, () => fetched('https://tools.example', { method: 'GET' }));
    await sendingWith(new Map(), () => fetched('https://tools.example', { method: 'POST', body }));

    expect(seen.slice(0, 4)).toEqual([body, undefined, expect.any(ReadableStream), 'half']);
    expect(seen.slice(4)).toEqual([undefined, undefined, body, undefined]);
    expect([splicesInFlight(), sendingWith(sent.splices, () => splicesInFlight()?.size)]).toEqual([undefined, 1]);
  });
});

import { Buffer } from 'node:buffer';

import { assetContentOf, assetUnusable, type HeldAsset } from '@on.auto/operations';
import { Effect, Function } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { observations } from '../clients/observed-requests.ts';
import { StdioProcessTransport } from '../clients/stdio-transport.ts';
import { until } from '../testing/until.ts';
import type { SentAsset } from './planned-assets.ts';
import { argumentsSent, sendingWith } from './spliced-bodies.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const echoed = 'process.stdin.pipe(process.stdout)';

function echoingProgram() {
  const received: unknown[] = [];
  const transport = new StdioProcessTransport(
    { command: process.execPath, args: ['--eval', echoed], env: {} },
    observations(null, Infinity),
    { scrub: String, report: Function.constVoid },
  );
  Object.assign(transport, {
    onmessage: (message: unknown) => {
      received.push(message);
    },
  } satisfies Pick<StdioProcessTransport, 'onmessage'>);
  closing.push(() => transport.close());
  return { transport, received };
}

function heldOf(text: string, opened?: HeldAsset['opened']): HeldAsset {
  const bytes = Buffer.from(text);
  return {
    id: 'asset-1',
    mediaType: 'text/plain',
    bytes: bytes.byteLength,
    sha256: 'a'.repeat(64),
    content: assetContentOf('text/plain'),
    opened:
      opened ??
      (() =>
        Effect.succeed(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              for (let at = 0; at < bytes.byteLength; at += 65_536) {
                controller.enqueue(bytes.subarray(at, at + 65_536));
              }
              controller.close();
            },
          }),
        )),
  };
}

function noticeOf(params: Readonly<Record<string, unknown>>) {
  return { jsonrpc: '2.0', method: 'notice', params };
}

function sent(held: HeldAsset): SentAsset {
  return { pointer: '/content', place: ['content'], encoding: 'text', bytes: 0, held };
}

describe('a message that holds an asset, written to a program', () => {
  it('is written whole before a message sent after it, however long the asset takes to write', async () => {
    const { transport, received } = echoingProgram();
    await transport.start();
    const text = 'é'.repeat(1_500_000);
    const { input, splices } = argumentsSent({ content: {} }, [sent(heldOf(text))]);

    const first = sendingWith(splices, () => transport.send(noticeOf(input)));
    const second = transport.send(noticeOf({ n: 2 }));
    const third = transport.send(noticeOf({ n: 3 }));
    await Promise.all([first, second, third]);
    await until(() => received.length >= 3);

    expect(received).toEqual([noticeOf({ content: text }), noticeOf({ n: 2 }), noticeOf({ n: 3 })]);
  });

  it('ends its line and fails where the asset can no longer be read, and the next message still arrives whole', async () => {
    const { transport, received } = echoingProgram();
    await transport.start();
    const gone = heldOf('', () =>
      Effect.fail(assetUnusable('content_gone', { id: 'asset-1', sha256: 'a'.repeat(64) })),
    );
    const { input, splices } = argumentsSent({ content: {} }, [sent(gone)]);

    const failed = sendingWith(splices, () => transport.send(noticeOf(input)));
    const next = transport.send(noticeOf({ n: 2 }));

    await expect(failed).rejects.toThrow('The content of the asset asset-1 is no longer kept');
    await next;
    await until(() => received.length > 0);
    expect(received).toEqual([noticeOf({ n: 2 })]);
  });
});

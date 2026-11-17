import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { FetchLike } from '@modelcontextprotocol/client';
import { Effect } from 'effect';

import { encodedAs } from './encoded-pieces.ts';
import type { SentAsset } from './planned-assets.ts';

export type Splices = ReadonlyMap<string, SentAsset>;

export interface ArgumentsSent {
  readonly input: Readonly<Record<string, unknown>>;
  readonly splices: Splices;
}

type Arguments = Readonly<Record<string, unknown>>;

const encoder = new TextEncoder();

function replacedAt(value: unknown, tokens: readonly string[], replacement: string): unknown {
  const [token, ...rest] = tokens;
  if (token === undefined) {
    return replacement;
  }
  return Array.isArray(value)
    ? value.map((item: unknown, index) => (String(index) === token ? replacedAt(item, rest, replacement) : item))
    : replacedIn(new Object(value), token, rest, replacement);
}

function replacedIn(record: object, token: string, rest: readonly string[], replacement: string): Arguments {
  const entries = Object.entries(record);
  return Object.fromEntries(
    entries.map(([key, member]: readonly [string, unknown]) => [
      key,
      key === token ? replacedAt(member, rest, replacement) : member,
    ]),
  );
}

export function argumentsSent(input: Arguments, sent: readonly SentAsset[]): ArgumentsSent {
  const splices = new Map(sent.map((asset) => [randomUUID(), asset]));
  const replaced = [...splices].reduce<Arguments>(
    (
      value,
      [
        token,
        {
          place: [first, ...rest],
        },
      ]: readonly [string, SentAsset],
    ) => replacedIn(value, first, rest, token),
    input,
  );
  return { input: replaced, splices };
}

type Controller = Readonly<ReadableStreamDefaultController<Uint8Array>>;

function contentOf(asset: SentAsset): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const opened = Effect.mapError(asset.held.opened(), ({ detail }) => new Error(detail));
  return new ReadableStream<Uint8Array>({
    pull: async (controller: Controller) => {
      reader ??= encodedAs(asset.encoding, await Effect.runPromise(opened)).getReader();
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel: (reason) => reader?.cancel(reason),
  });
}

type Part = { readonly text: string } | { readonly asset: SentAsset };

interface Placed {
  readonly quoted: string;
  readonly asset: SentAsset;
  readonly at: number;
}

function placedIn(text: string, splices: Splices): readonly Placed[] {
  return [...splices]
    .map(([token, asset]: readonly [string, SentAsset]): Placed => {
      const quoted = JSON.stringify(token);
      return { quoted, asset, at: text.indexOf(quoted) };
    })
    .filter(({ at }) => at >= 0)
    .toSorted((first, second) => first.at - second.at);
}

function partsOf(text: string, placed: readonly Placed[]): readonly Part[] {
  const parts: Part[] = [];
  let from = 0;
  for (const { quoted, asset, at } of placed) {
    parts.push({ text: text.slice(from, at) }, { asset });
    from = at + quoted.length;
  }
  parts.push({ text: text.slice(from) });
  return parts;
}

function streamOf(parts: readonly Part[]): ReadableStream<Uint8Array> {
  const pending = [...parts];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const nextReader = (controller: Controller): ReadableStreamDefaultReader<Uint8Array> | undefined => {
    const part = pending.shift();
    if (part === undefined) {
      controller.close();
      return undefined;
    }
    if ('text' in part) {
      controller.enqueue(encoder.encode(part.text));
      return undefined;
    }
    return contentOf(part.asset).getReader();
  };
  const pulled = async (controller: Controller): Promise<void> => {
    reader ??= nextReader(controller);
    const read = await reader?.read();
    if (read?.done === false) {
      controller.enqueue(read.value);
    } else if (read?.done === true) {
      reader = undefined;
      await pulled(controller);
    }
  };
  return new ReadableStream<Uint8Array>({ pull: pulled, cancel: (reason) => reader?.cancel(reason) });
}

export interface SplicedBody {
  readonly stream: ReadableStream<Uint8Array>;
  readonly length: number;
}

function lengthOf(text: string, placed: readonly Placed[]): number {
  return placed.reduce(
    (length, { quoted, asset }: Placed) => length - quoted.length + asset.bytes,
    encoder.encode(text).byteLength,
  );
}

export function splicedBody(text: string, splices: Splices): SplicedBody | undefined {
  const placed = placedIn(text, splices);
  return placed.length === 0 ? undefined : { stream: streamOf(partsOf(text, placed)), length: lengthOf(text, placed) };
}

const inFlight = new AsyncLocalStorage<Splices>();

export function sendingWith<A>(splices: Splices, send: () => A): A {
  return splices.size === 0 ? send() : inFlight.run(splices, send);
}

export function splicesInFlight(): Splices | undefined {
  return inFlight.getStore();
}

type Address = string | Readonly<URL>;

export function splicingFetch(fetch: FetchLike): (...args: readonly [Address, unknown?]) => Promise<Response> {
  return (...[url, init]: readonly [Address, unknown?]) => {
    const asked: RequestInit = Object.assign({}, init);
    const splices = splicesInFlight();
    const spliced =
      splices === undefined || typeof asked.body !== 'string' ? undefined : splicedBody(asked.body, splices);
    if (spliced === undefined) {
      return fetch(url, asked);
    }
    const headers = new Headers(asked.headers);
    headers.set('content-length', String(spliced.length));
    const streamed: RequestInit & { readonly duplex: 'half' } = {
      ...asked,
      headers,
      body: spliced.stream,
      duplex: 'half',
    };
    return fetch(url, streamed);
  };
}

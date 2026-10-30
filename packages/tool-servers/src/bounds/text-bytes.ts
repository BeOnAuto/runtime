import { Buffer } from 'node:buffer';

const continuationMask = 0xc0;

const continuationByte = 0x80;

export function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function cutAtCodePoint(text: string, mostBytes: number): string {
  const encoded = Buffer.from(text, 'utf8');
  if (encoded.length <= mostBytes) {
    return text;
  }
  let end = Math.max(0, mostBytes);
  while (end > 0 && (encoded.readUInt8(end) & continuationMask) === continuationByte) {
    end -= 1;
  }
  return encoded.subarray(0, end).toString('utf8');
}

function storedBytesOf(character: string): number {
  return bytesOf(JSON.stringify(character)) - 2;
}

export function cutAsStored(text: string, mostBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += storedBytesOf(character);
    if (bytes > mostBytes) {
      return text.slice(0, end);
    }
    end += character.length;
  }
  return text;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => canonical(item));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([first]: readonly [string, unknown], [second]: readonly [string, unknown]) =>
          first < second ? -1 : 1,
        )
        .map(([key, item]: readonly [string, unknown]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(canonical(value));
}

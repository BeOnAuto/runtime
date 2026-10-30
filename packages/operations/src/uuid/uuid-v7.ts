const timestampLength = 6;

const counterLength = 2;

const randomLength = 8;

const highestCounter = 0xfff;

const highestSeed = 0x7ff;

interface Stamp {
  readonly milliseconds: number;
  readonly counter: number;
}

const noIdYet: Stamp = { milliseconds: Number.NEGATIVE_INFINITY, counter: highestCounter };

const markers: ReadonlyMap<number, (byte: number) => number> = new Map([
  [6, (byte: number) => 0x70 + (byte % 16)],
  [8, (byte: number) => 0x80 + (byte % 64)],
]);

function bigEndianBytesOf(value: number, length: number): readonly number[] {
  return Array.from({ length }, (_, index) => Math.floor(value / 256 ** (length - 1 - index)) % 256);
}

function bigEndianValueOf(bytes: readonly number[]): number {
  return bytes.reduce((value, byte) => value * 256 + byte, 0);
}

function randomBytesOf(length: number): readonly number[] {
  return [...crypto.getRandomValues(new Uint8Array(length))];
}

function seededAt(milliseconds: number): Stamp {
  return { milliseconds, counter: bigEndianValueOf(randomBytesOf(counterLength)) % (highestSeed + 1) };
}

function stampAfter(last: Stamp, now: number): Stamp {
  if (now > last.milliseconds) {
    return seededAt(now);
  }
  return last.counter < highestCounter
    ? { milliseconds: last.milliseconds, counter: last.counter + 1 }
    : seededAt(last.milliseconds + 1);
}

function hexOf(bytes: readonly number[]): string {
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidOf({ milliseconds, counter }: Stamp): string {
  const bytes = [
    ...bigEndianBytesOf(milliseconds, timestampLength),
    ...bigEndianBytesOf(counter, counterLength),
    ...randomBytesOf(randomLength),
  ];
  return hexOf(bytes.map((byte, index) => markers.get(index)?.(byte) ?? byte));
}

export function uuidV7TimeOf(milliseconds: number): string {
  return milliseconds.toString(16).padStart(timestampLength * 2, '0');
}

export function uuidV7Before(id: string, milliseconds: number): boolean {
  return `${id.slice(0, 8)}${id.slice(9, 13)}` < uuidV7TimeOf(milliseconds);
}

export function uuidV7MakerOn(now: () => number): () => string {
  let last = noIdYet;
  return () => {
    last = stampAfter(last, now());
    return uuidOf(last);
  };
}

export const randomUUIDv7 = uuidV7MakerOn(() => Date.now());

type Words = readonly [number, number, number, number, number];

const utf8 = new TextEncoder();

const wordsInABlock = 16;

const roundsInABlock = 80;

const startingWords: Words = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

function rotated(word: number, bits: number): number {
  return ((word << bits) | (word >>> (32 - bits))) >>> 0;
}

function lengthBytesOf(byteLength: number): readonly number[] {
  const bits = byteLength * 8;
  const high = Math.floor(bits / 2 ** 32);
  return [high >>> 24, high >>> 16, high >>> 8, high, bits >>> 24, bits >>> 16, bits >>> 8, bits].map(
    (byte) => byte & 0xff,
  );
}

function paddedWords(message: readonly number[]): readonly number[] {
  const zeros = (64 - ((message.length + 9) % 64)) % 64;
  const bytes = Uint8Array.from([
    ...message,
    0x80,
    ...Array.from({ length: zeros }, () => 0),
    ...lengthBytesOf(message.length),
  ]);
  const view = new DataView(bytes.buffer);
  return Array.from({ length: bytes.length / 4 }, (_, index) => view.getUint32(index * 4));
}

function scheduleOf(block: readonly number[]): readonly number[] {
  const view = new DataView(new ArrayBuffer(roundsInABlock * 4));
  for (const [index, word] of block.entries()) {
    view.setUint32(index * 4, word);
  }
  for (let round = wordsInABlock; round < roundsInABlock; round += 1) {
    const mixed = view.getUint32((round - 3) * 4) ^ view.getUint32((round - 8) * 4) ^ view.getUint32((round - 14) * 4);
    view.setUint32(round * 4, rotated(mixed ^ view.getUint32((round - 16) * 4), 1));
  }
  return Array.from({ length: roundsInABlock }, (_, round) => view.getUint32(round * 4));
}

function mixOf(round: number, b: number, c: number, d: number): number {
  if (round < 20) {
    return (b & c) | (~b & d);
  }
  if (round >= 40 && round < 60) {
    return (b & c) | (b & d) | (c & d);
  }
  return b ^ c ^ d;
}

function constantOf(round: number): number {
  if (round < 20) {
    return 0x5a827999;
  }
  if (round < 40) {
    return 0x6ed9eba1;
  }
  return round < 60 ? 0x8f1bbcdc : 0xca62c1d6;
}

function roundApplied([a, b, c, d, e]: Words, word: number, round: number): Words {
  const added = rotated(a, 5) + mixOf(round, b, c, d) + e + constantOf(round) + word;
  return [added >>> 0, a, rotated(b, 30), c, d];
}

function blockApplied(state: Words, block: readonly number[]): Words {
  const [a, b, c, d, e] = scheduleOf(block).reduce(
    (working: Words, word, round) => roundApplied(working, word, round),
    state,
  );
  const [a0, b0, c0, d0, e0] = state;
  return [(a0 + a) >>> 0, (b0 + b) >>> 0, (c0 + c) >>> 0, (d0 + d) >>> 0, (e0 + e) >>> 0];
}

function sha1Of(message: readonly number[]): readonly number[] {
  const words = paddedWords(message);
  const blocks: readonly (readonly number[])[] = Array.from({ length: words.length / wordsInABlock }, (_, block) =>
    words.slice(block * wordsInABlock, (block + 1) * wordsInABlock),
  );
  const digest = blocks.reduce((state: Words, block) => blockApplied(state, block), startingWords);
  return digest.flatMap((word) => [word >>> 24, word >>> 16, word >>> 8, word].map((byte) => byte & 0xff));
}

function bytesOfUuid(uuid: string): readonly number[] {
  const hex = uuid.replaceAll('-', '');
  return Array.from({ length: 16 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function uuidOf(bytes: readonly number[]): string {
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const markers: ReadonlyMap<number, (byte: number) => number> = new Map([
  [6, (byte: number) => (byte & 0x0f) | 0x50],
  [8, (byte: number) => (byte & 0x3f) | 0x80],
]);

export function uuidV5(namespace: string, name: string): string {
  const hash = sha1Of([...bytesOfUuid(namespace), ...utf8.encode(name)]).slice(0, 16);
  return uuidOf(hash.map((byte, index) => markers.get(index)?.(byte) ?? byte));
}

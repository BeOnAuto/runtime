const audioFormats: ReadonlyMap<string, string> = new Map([
  ['mp3', 'audio/mpeg'],
  ['wav', 'audio/wav'],
  ['opus', 'audio/ogg'],
  ['aac', 'audio/aac'],
  ['flac', 'audio/flac'],
]);

export const knownAudioFormats: readonly string[] = [...audioFormats.keys()];

export function mediaTypeOfFormat(format: string): string | undefined {
  return audioFormats.get(format);
}

interface Mark {
  readonly at: number;
  readonly bytes: readonly number[];
}

interface Signature {
  readonly mediaType: string;
  readonly marks: readonly Mark[];
}

const imageSignatures: readonly Signature[] = [
  { mediaType: 'image/png', marks: [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  { mediaType: 'image/jpeg', marks: [{ at: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { mediaType: 'image/gif', marks: [{ at: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
  {
    mediaType: 'image/webp',
    marks: [
      { at: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
];

function holds(content: Readonly<Uint8Array>, { at, bytes }: Mark): boolean {
  return bytes.every((byte, index) => content[at + index] === byte);
}

function startsWith(content: Readonly<Uint8Array>, { marks }: Signature): boolean {
  return marks.every((mark) => holds(content, mark));
}

export function imageMediaTypeOf(content: Readonly<Uint8Array>): string | undefined {
  return imageSignatures.find((signature) => startsWith(content, signature))?.mediaType;
}

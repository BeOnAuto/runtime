import { Buffer } from 'node:buffer';

import { Option, Schema } from 'effect';

import { imageMediaTypeOf, mediaTypeOfFormat } from '../catalog/media-types.ts';

export type BodyRead = { readonly bytes: Readonly<Uint8Array> } | { readonly tooLarge: true };

export async function bodyWithin(body: ReadableStream<Uint8Array> | null, mostBytes: number): Promise<BodyRead> {
  const chunks: Uint8Array[] = [];
  let read = 0;
  for await (const chunk of body ?? new Blob([]).stream()) {
    read += chunk.byteLength;
    if (read > mostBytes) {
      return { tooLarge: true };
    }
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks) };
}

const utf8 = new TextDecoder();

export function jsonOf(bytes: Readonly<Uint8Array>): unknown {
  try {
    const parsed: unknown = JSON.parse(utf8.decode(bytes));
    return parsed;
  } catch {
    return undefined;
  }
}

const ImageAnswerSchema = Schema.Struct({
  data: Schema.NonEmptyArray(
    Schema.Struct({ b64_json: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/u)) }),
  ),
});

const decodeImageAnswer = Schema.decodeUnknownOption(ImageAnswerSchema);

function firstImageOf(answer: unknown): string | undefined {
  return Option.getOrUndefined(Option.map(decodeImageAnswer(answer), ({ data }) => data[0].b64_json));
}

export interface Image {
  readonly bytes: Readonly<Uint8Array>;
  readonly mediaType: string;
}

export function imageIn(answer: unknown): Image | undefined {
  const encoded = firstImageOf(answer);
  if (encoded === undefined) {
    return undefined;
  }
  const bytes = Buffer.from(encoded, 'base64');
  const mediaType = imageMediaTypeOf(bytes);
  return mediaType === undefined ? undefined : { bytes, mediaType };
}

const audioMediaType = /^audio\/[a-z0-9][a-z0-9.+-]*$/u;

const videoMediaType = /^video\/[a-z0-9][a-z0-9.+-]*$/u;

export function namedMediaTypeOf(contentType: string | null): string | undefined {
  const named = contentType?.split(';')[0]?.trim().toLowerCase();
  return named === '' ? undefined : named;
}

export function isAudio(mediaType: string): boolean {
  return audioMediaType.test(mediaType);
}

export function isVideo(mediaType: string): boolean {
  return videoMediaType.test(mediaType);
}

export const mostHandleCharacters = 1024;

const VideoAnswerSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostHandleCharacters)),
  status: Schema.String,
  progress: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  error: Schema.optionalKey(Schema.Unknown),
});

export type VideoAnswer = typeof VideoAnswerSchema.Type;

const decodeVideoAnswer = Schema.decodeUnknownOption(VideoAnswerSchema);

export function videoAnswerIn(answer: unknown): VideoAnswer | undefined {
  return Option.getOrUndefined(decodeVideoAnswer(answer));
}

export function audioMediaTypeOf(named: string | undefined, format: string): string {
  return named ?? mediaTypeOfFormat(format) ?? 'audio/mpeg';
}

export function costIn(headers: Readonly<Headers>, header: string | null): number | undefined {
  const said = header === null ? undefined : headers.get(header)?.trim();
  if (said === undefined || said === '') {
    return undefined;
  }
  const cost = Number(said);
  return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

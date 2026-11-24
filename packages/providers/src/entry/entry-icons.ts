import { Buffer } from 'node:buffer';

import { Schema } from 'effect';

export const IconMediaTypeSchema = Schema.Literals(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']);

type IconMediaType = typeof IconMediaTypeSchema.Type;

export const IconThemeSchema = Schema.Literals(['light', 'dark']);

export const IconSizesSchema = Schema.Array(
  Schema.String.check(Schema.isPattern(/^(?:any|[1-9]\d{0,3}x[1-9]\d{0,3})$/u)),
);

const iconBesideTheEntries = /^icons\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:svg|png|jpg|jpeg|webp)$/u;

const EntryIconSchema = Schema.Struct({
  src: Schema.String.check(Schema.isPattern(iconBesideTheEntries)).annotate({
    description: 'The file of the icon beside the entries, icons/<name> with the extension of its type',
  }),
  mimeType: Schema.optionalKey(
    IconMediaTypeSchema.annotate({ description: "The image's file type, such as image/png." }),
  ),
  sizes: Schema.optionalKey(
    IconSizesSchema.annotate({
      description: 'The sizes the image is made for, such as 48x48, or any for an image that scales.',
    }),
  ),
  theme: Schema.optionalKey(
    IconThemeSchema.annotate({
      description:
        'light for an image made for a light background, dark for one made for a dark background. Left out when the image suits both.',
    }),
  ),
});

export type EntryIcon = typeof EntryIconSchema.Type;

export const EntryIconsSchema = Schema.Array(EntryIconSchema).check(Schema.isMinLength(1)).annotate({
  description: "Images of the service's logo, to show beside its name. Left out when the service has none.",
});

export interface ListedIcon {
  readonly src: string;
  readonly mimeType: IconMediaType;
  readonly sizes?: readonly string[];
  readonly theme?: typeof IconThemeSchema.Type;
}

export const mostIconBytes = 16 * 1024;

const number = '-?\\d+(?:\\.\\d+)?';

const svgOfPaths = new RegExp(
  `^<svg xmlns="http://www\\.w3\\.org/2000/svg" viewBox="${number} ${number} ${number} ${number}">(?:<path fill="#[0-9A-F]{6}" d="[0-9MmZzLlHhVvCcSsQqTtAaEe.,\\s+-]+"/>)+</svg>\\n?$`,
  'u',
);

type Signature = readonly (readonly [at: number, bytes: readonly number[]])[];

const signatures: readonly (readonly [IconMediaType, Signature])[] = [
  ['image/png', [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]]],
  ['image/jpeg', [[0, [0xff, 0xd8, 0xff]]]],
  [
    'image/webp',
    [
      [0, [0x52, 0x49, 0x46, 0x46]],
      [8, [0x57, 0x45, 0x42, 0x50]],
    ],
  ],
];

function isSigned(bytes: Readonly<Uint8Array>, signature: Signature): boolean {
  return signature.every(([at, expected]) => expected.every((byte, index) => bytes[at + index] === byte));
}

function isSvgOfPaths(bytes: Readonly<Uint8Array>): boolean {
  try {
    return svgOfPaths.test(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return false;
  }
}

export function iconTypeOf(bytes: Readonly<Uint8Array>, mostBytes: number = mostIconBytes): IconMediaType | undefined {
  if (bytes.length === 0 || bytes.length > mostBytes) {
    return undefined;
  }
  const signed = signatures.find(([, signature]) => isSigned(bytes, signature));
  if (signed !== undefined) {
    return signed[0];
  }
  return isSvgOfPaths(bytes) ? 'image/svg+xml' : undefined;
}

export function listedIconOf(
  { sizes, theme }: EntryIcon,
  mimeType: IconMediaType,
  bytes: Readonly<Uint8Array>,
): ListedIcon {
  return {
    src: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
    mimeType,
    ...(sizes === undefined ? {} : { sizes }),
    ...(theme === undefined ? {} : { theme }),
  };
}

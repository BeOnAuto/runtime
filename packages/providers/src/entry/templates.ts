import { placeholdersIn, placeholdersReplaced } from '@on.auto/config';

type Holding = 'address' | 'value';

export interface TemplatedField {
  readonly path: readonly string[];
  readonly text: string;
  readonly holds: Holding;
}

interface ServerPart {
  readonly url?: string;
  readonly document?: string;
  readonly base_url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query_params?: Readonly<Record<string, string>>;
  readonly credentials?: readonly WayAddresses[];
}

export interface Marked {
  readonly text: string;
  readonly markers: ReadonlyMap<string, string>;
}

const addresses = ['url', 'document', 'base_url'] as const;

export const wayAddresses = ['issuer', 'authorization_endpoint', 'token_endpoint', 'revocation_endpoint'] as const;

export type WayAddress = (typeof wayAddresses)[number];

export type WayAddresses = Partial<Readonly<Record<WayAddress, string>>>;

const valueFields = ['headers', 'query_params'] as const;

function markerOf(position: number): string {
  return `placeholder${String(position)}marker`;
}

function wayAddressesOf({ credentials = [] }: ServerPart): readonly TemplatedField[] {
  return credentials.flatMap((way, index) =>
    wayAddresses.flatMap((field): readonly TemplatedField[] => {
      const text = way[field];
      return text === undefined ? [] : [{ path: ['credentials', String(index), field], text, holds: 'address' }];
    }),
  );
}

export function templatedFieldsOf(entry: ServerPart): readonly TemplatedField[] {
  return [
    ...addresses.flatMap((field): readonly TemplatedField[] => {
      const text = entry[field];
      return text === undefined ? [] : [{ path: [field], text, holds: 'address' }];
    }),
    ...wayAddressesOf(entry),
    ...valueFields.flatMap((field) =>
      Object.entries(entry[field] ?? {}).map(([key, text]: readonly [string, string]): TemplatedField => ({
        path: [field, key],
        text,
        holds: 'value',
      })),
    ),
  ];
}

export function namesIn(text: string): readonly string[] {
  return [...new Set(placeholdersIn(text))];
}

export function marked(text: string, valueOf: (name: string) => string | undefined): Marked {
  const markers = new Map<string, string>();
  const markedText = placeholdersReplaced(text, (name) => {
    const value = valueOf(name);
    if (value !== undefined) {
      return value;
    }
    const marker = markerOf(markers.size);
    markers.set(marker, name);
    return marker;
  });
  return { text: markedText, markers };
}

function unmarked(text: string, markers: ReadonlyMap<string, string>, shown: (name: string) => string): string {
  return [...markers].reduce(
    (written, [marker, name]: readonly [string, string]) => written.replaceAll(marker, shown(name)),
    text,
  );
}

export function isAddress(text: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/iu.test(text);
}

export function hostTemplateOf(address: string, valueOf: (name: string) => string | undefined): string {
  const { text, markers } = marked(address, valueOf);
  return unmarked(new URL(text).hostname, markers, (name) => `{${name}}`);
}

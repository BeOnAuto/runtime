import { JsonPointer, Option, Predicate, Schema } from 'effect';

const assetReferenceMembers = ['id', 'media_type', 'bytes', 'sha256', 'address', 'address_until'] as const;

const AssetReferenceSchema = Schema.Struct({
  id: Schema.String,
  media_type: Schema.String,
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  address: Schema.NullOr(Schema.String),
  address_until: Schema.NullOr(Schema.String),
});

export type AssetReference = typeof AssetReferenceSchema.Type;

export interface PlacedAsset {
  readonly pointer: string;
  readonly reference: AssetReference | undefined;
  readonly shaped: Readonly<Record<string, unknown>>;
}

const decodeReference = Schema.decodeUnknownOption(AssetReferenceSchema);

const members: ReadonlySet<string> = new Set(assetReferenceMembers);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Predicate.isObject(value) && !Array.isArray(value);
}

export function isAssetShaped(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === members.size && keys.every((key) => members.has(key));
}

export function assetReferenceOf(value: unknown): AssetReference | undefined {
  return isAssetShaped(value) ? Option.getOrUndefined(decodeReference(value)) : undefined;
}

function placedIn(value: unknown, pointer: string): readonly PlacedAsset[] {
  if (isAssetShaped(value)) {
    return [{ pointer, reference: assetReferenceOf(value), shaped: value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) => placedIn(item, `${pointer}/${index}`));
  }
  return isRecord(value)
    ? Object.entries(value).flatMap(([key, member]: readonly [string, unknown]) =>
        placedIn(member, `${pointer}/${JsonPointer.escapeToken(key)}`),
      )
    : [];
}

export function assetsIn(value: unknown): readonly PlacedAsset[] {
  return placedIn(value, '');
}

export function holdsAnAsset(value: unknown): boolean {
  return assetsIn(value).length > 0;
}

export type AssetContent = 'text' | 'json' | 'file';

const parameters = /;.*$/su;

function essenceOf(mediaType: string): string {
  return mediaType.replace(parameters, '').trim().toLowerCase();
}

export function assetContentOf(mediaType: string): AssetContent {
  const essence = essenceOf(mediaType);
  if (essence === 'application/json' || essence.endsWith('+json')) {
    return 'json';
  }
  return essence.startsWith('text/') ? 'text' : 'file';
}

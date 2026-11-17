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

type Token = string | number;

function pointerOf(tokens: readonly Token[]): string {
  return tokens.map((token) => `/${typeof token === 'number' ? token : JsonPointer.escapeToken(token)}`).join('');
}

export function assetsIn(value: unknown): readonly PlacedAsset[] {
  const placed: PlacedAsset[] = [];
  const tokens: Token[] = [];
  const placeWithin = (each: unknown): void => {
    if (isAssetShaped(each)) {
      placed.push({ pointer: pointerOf(tokens), reference: assetReferenceOf(each), shaped: each });
      return;
    }
    if (Array.isArray(each)) {
      for (let index = 0; index < each.length; index += 1) {
        const item: unknown = each[index];
        tokens.push(index);
        placeWithin(item);
        tokens.pop();
      }
      return;
    }
    if (isRecord(each)) {
      for (const key of Object.keys(each)) {
        tokens.push(key);
        placeWithin(each[key]);
        tokens.pop();
      }
    }
  };
  placeWithin(value);
  return placed;
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

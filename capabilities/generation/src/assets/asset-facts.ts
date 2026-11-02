import { ActedContextSchema, factOf, RunContextSchema, type Decided } from '@on.auto/operations';
import { Schema } from 'effect';

export const assetsKind = 'assets';

const DigestSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));

const BytesSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const KindSchema = Schema.Literals(['image', 'audio', 'video']);

const ParametersSchema = Schema.Struct({
  size: Schema.optionalKey(Schema.String),
  aspect: Schema.optionalKey(Schema.String),
  quality: Schema.optionalKey(Schema.String),
  voice: Schema.optionalKey(Schema.String),
  format: Schema.optionalKey(Schema.String),
  duration: Schema.optionalKey(Schema.Int),
});

const ReferenceSchema = Schema.Struct({ id: Schema.String, sha256: DigestSchema });

export const AssetKeptSchema = factOf(
  'asset_kept',
  Schema.Struct({
    media_type: Schema.String,
    bytes: BytesSchema,
    sha256: DigestSchema,
    kind: KindSchema,
    model: Schema.String,
    prompt: Schema.String,
    parameters: ParametersSchema,
    references: Schema.Array(ReferenceSchema),
    cost_usd: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))),
    own_key: Schema.Boolean,
    expires_at: Schema.String,
  }),
  RunContextSchema,
);

const AssetExpiredSchema = factOf(
  'asset_expired',
  Schema.Struct({ bytes: BytesSchema, content_removed: Schema.Boolean }),
  ActedContextSchema,
);

export const AssetEventSchema = Schema.Union([AssetKeptSchema, AssetExpiredSchema]);

export type AssetEvent = typeof AssetEventSchema.Type;

type AssetKept = typeof AssetKeptSchema.Type;

export type AssetKeptData = AssetKept['data'];

export type DecidedAssetEvent = Decided<AssetEvent>;

export function assetStreamOf(id: string): string {
  return `${assetsKind}/${id}`;
}

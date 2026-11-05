import {
  ActedContextSchema,
  earlierShapeOf,
  factOf,
  readingEarlierShapes,
  RunContextSchema,
  type Decided,
} from '@on.auto/operations';
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

const generationFields = {
  model: Schema.String,
  prompt: Schema.String,
  parameters: ParametersSchema,
  references: Schema.Array(ReferenceSchema),
  cost_usd: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))),
  own_key: Schema.Boolean,
};

export const madeByFields = { kind: KindSchema, ...generationFields };

const ToolCallSchema = Schema.Struct({
  call_id: Schema.String,
  server: Schema.String,
  connection_id: Schema.optionalKey(Schema.String),
  tool: Schema.String,
});

const MadeBySchema = Schema.Union([
  Schema.Struct({ generation: Schema.Struct(generationFields) }),
  Schema.Struct({ tool_call: ToolCallSchema }),
]);

export type ToolCallOfAnAsset = typeof ToolCallSchema.Type;

const keptFields = { media_type: Schema.String, bytes: BytesSchema, sha256: DigestSchema };

const AssetKeptNowSchema = factOf(
  'asset_kept',
  Schema.Struct({ ...keptFields, kind: KindSchema, made_by: MadeBySchema, expires_at: Schema.String }),
  RunContextSchema,
  { content: { holds: ['/sha256'] } },
);

const AssetKeptBeforeSchema = factOf(
  'asset_kept',
  Schema.Struct({ ...keptFields, ...madeByFields, expires_at: Schema.String }),
  RunContextSchema,
);

function madeByAGeneration({ data, ...fact }: typeof AssetKeptBeforeSchema.Type): typeof AssetKeptNowSchema.Type {
  const { media_type: mediaType, bytes, sha256, kind, expires_at: expiresAt, ...generation } = data;
  return {
    ...fact,
    data: { media_type: mediaType, bytes, sha256, kind, made_by: { generation }, expires_at: expiresAt },
  };
}

export const AssetKeptSchema = readingEarlierShapes(AssetKeptNowSchema, [
  earlierShapeOf(AssetKeptBeforeSchema, madeByAGeneration),
]);

const AssetExpiredSchema = factOf('asset_expired', Schema.Struct({ bytes: BytesSchema }), ActedContextSchema, {
  content: { releases: 'all' },
});

const AssetContentRemovedSchema = factOf(
  'asset_content_removed',
  Schema.Struct({ bytes: BytesSchema, sha256: DigestSchema }),
  ActedContextSchema,
);

export const AssetEventSchema = Schema.Union([AssetKeptSchema, AssetExpiredSchema, AssetContentRemovedSchema]);

export type AssetEvent = typeof AssetEventSchema.Type;

type AssetKept = typeof AssetKeptSchema.Type;

export type AssetKeptData = AssetKept['data'];

export type AssetMadeBy = AssetKeptData['made_by'];

export type DecidedAssetEvent = Decided<AssetEvent>;

export function assetStreamOf(id: string): string {
  return `${assetsKind}/${id}`;
}

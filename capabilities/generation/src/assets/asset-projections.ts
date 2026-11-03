import { factReaderOf, type KeyedProjection, type ProjectedMessage, type ProjectedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { AssetEventSchema, assetsKind } from './asset-facts.ts';

export const assetsName = 'assets';

export const assetTotalsName = 'asset_totals';

export const totalsKey = 'playbook';

const readAsset = factReaderOf(AssetEventSchema);

const AssetRowSchema = Schema.Struct({
  media_type: Schema.String,
  bytes: Schema.Int,
  sha256: Schema.String,
  kind: Schema.String,
  model: Schema.String,
  run: Schema.String,
  kept_at: Schema.Int,
  expires_at: Schema.NullOr(Schema.Int),
  expired_at: Schema.NullOr(Schema.Int),
  live: Schema.Boolean,
});

export type AssetRow = typeof AssetRowSchema.Type;

const decodeAssetRow = Schema.decodeUnknownOption(AssetRowSchema);

export const assetRowFrom: (row: unknown) => AssetRow = Schema.decodeUnknownSync(AssetRowSchema);

export function assetRowOf(row: ProjectedRow | undefined): AssetRow | undefined {
  return row === undefined ? undefined : Option.getOrUndefined(decodeAssetRow(row));
}

const TotalsRowSchema = Schema.Struct({ bytes: Schema.Int, assets: Schema.Int });

export type TotalsRow = typeof TotalsRowSchema.Type;

const decodeTotalsRow = Schema.decodeUnknownOption(TotalsRowSchema);

const noTotals: TotalsRow = { bytes: 0, assets: 0 };

export function totalsRowOf(row: ProjectedRow | undefined): TotalsRow {
  return row === undefined ? noTotals : Option.getOrElse(decodeTotalsRow(row), () => noTotals);
}

function rowOfTheAsset(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = readAsset(message);
  if (fact?.type === 'asset_kept') {
    const { data, context } = fact;
    return {
      media_type: data.media_type,
      bytes: data.bytes,
      sha256: data.sha256,
      kind: data.kind,
      model: data.model,
      run: context.runId,
      kept_at: Date.parse(context.at),
      expires_at: Date.parse(data.expires_at),
      expired_at: null,
      live: true,
    };
  }
  const kept = assetRowOf(row);
  return kept === undefined || fact === undefined
    ? undefined
    : { ...kept, expires_at: null, expired_at: Date.parse(fact.context.at), live: false };
}

function totalsAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = readAsset(message);
  if (fact === undefined) {
    return undefined;
  }
  const { bytes, assets } = totalsRowOf(row);
  const sign = fact.type === 'asset_kept' ? 1 : -1;
  return { bytes: bytes + sign * fact.data.bytes, assets: assets + sign };
}

const assetTypes = ['asset_kept', 'asset_expired'];

export const assets: KeyedProjection = {
  name: assetsName,
  version: 1,
  kinds: [assetsKind],
  types: assetTypes,
  columns: [
    { name: 'media_type', kind: 'text' },
    { name: 'bytes', kind: 'integer' },
    { name: 'sha256', kind: 'text' },
    { name: 'kind', kind: 'text' },
    { name: 'model', kind: 'text' },
    { name: 'run', kind: 'text' },
    { name: 'kept_at', kind: 'integer' },
    { name: 'expires_at', kind: 'integer' },
    { name: 'expired_at', kind: 'integer' },
    { name: 'live', kind: 'boolean' },
  ],
  indexes: [{ name: 'expiring', columns: ['expires_at'], acrossPlaybooks: true, whereSet: 'expires_at' }],
  rowAfter: rowOfTheAsset,
};

export const assetTotals: KeyedProjection = {
  name: assetTotalsName,
  version: 1,
  kinds: [assetsKind],
  types: assetTypes,
  columns: [
    { name: 'bytes', kind: 'integer' },
    { name: 'assets', kind: 'integer' },
  ],
  indexes: [],
  keyOf: () => totalsKey,
  rowAfter: totalsAfter,
};

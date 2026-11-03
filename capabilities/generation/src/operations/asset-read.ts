import { NotFound, PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Clock, Effect, Schema, SchemaTransformation } from 'effect';

import { assetDecider } from '../assets/asset-decider.ts';
import { assetStreamOf } from '../assets/asset-facts.ts';
import { assetRowOf, assetsName, hasExpired, rowKeyed } from '../assets/asset-projections.ts';
import { addressOf, noAddress } from '../assets/asset-reference.ts';
import type { AssetAddresses } from '../capability/generation-ports.ts';

export const AssetIdInputField = Schema.String.annotate({
  description: "The asset's id, a UUID in any case, kept in lowercase",
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

function nullOr(description: string) {
  return Schema.NullOr(Schema.String).annotate({ description });
}

export const AssetReadSchema = Schema.Struct({
  id: Schema.String.annotate({ description: "The asset's id, which another function takes as a reference" }),
  media_type: Schema.String.annotate({ description: 'The media type of its bytes, such as image/png or audio/mpeg' }),
  bytes: Schema.Int.annotate({ description: 'Its size in bytes' }),
  sha256: Schema.String.annotate({ description: 'The SHA-256 of its bytes, in lowercase hex' }),
  model: Schema.String.annotate({ description: 'The model that made it, as its function names it' }),
  kept_at: Schema.String.annotate({ description: 'When the playbook kept it, in ISO 8601 UTC' }),
  expires_at: nullOr('When it expires, in ISO 8601 UTC, or null once its expiry is recorded'),
  expired_at: nullOr('When its expiry was recorded, in ISO 8601 UTC, or null while it is kept'),
  expired: Schema.Boolean.annotate({
    description: 'Whether it has expired, from the moment it expires, whether or not its expiry is recorded yet',
  }),
  content_removed: Schema.Boolean.annotate({
    description: 'Whether its content was removed as it expired, since nothing else of the playbook held it',
  }),
  address: nullOr(
    'An address its bytes are read at without a key until address_until, signed as it was read, or null once it expired or where the runtime signs none',
  ),
  address_until: nullOr('When the address stops being answered, or null'),
}).annotate({ identifier: 'Asset', description: 'An asset a generation function made, as the playbook keeps it now' });

export type AssetRead = typeof AssetReadSchema.Type;

function momentOf(milliseconds: number | null): string | null {
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

const noSuchAsset = new NotFound({ detail: 'There is no such asset in this playbook' });

export function assetRead(addresses: AssetAddresses | undefined, id: string) {
  return Effect.gen(function* () {
    const reader = yield* PlaybookReader;
    const { state: standing } = yield* reader.load(assetStreamOf(id), assetDecider);
    const [kept] = yield* reader.readProjectedRows(assetsName, rowKeyed(id));
    const row = assetRowOf(kept?.row);
    if (row === undefined) {
      return yield* Effect.fail(noSuchAsset);
    }
    const playbook = yield* PlaybookContext;
    const now = yield* Clock.currentTimeMillis;
    const expired = hasExpired(row, now);
    const read: AssetRead = {
      id,
      media_type: row.media_type,
      bytes: row.bytes,
      sha256: row.sha256,
      model: row.model,
      kept_at: new Date(row.kept_at).toISOString(),
      expires_at: momentOf(row.expires_at),
      expired_at: momentOf(row.expired_at),
      expired,
      content_removed: standing === 'removed',
      ...(expired ? noAddress : addressOf(addresses, playbook, row.sha256, now)),
    };
    return read;
  });
}

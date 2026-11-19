import { sha256Of } from '@on.auto/content';
import { Predicate, Schema } from 'effect';
import { errors, type Adapter, type AdapterFactory, type AdapterPayload } from 'oidc-provider';

import type { ProviderRows, StoredPayload } from './provider-rows.ts';

const PayloadSchema = Schema.Record(Schema.String, Schema.Unknown);

const payloadFromJson = Schema.decodeUnknownSync(Schema.fromJsonString(PayloadSchema));

const millisecondsInASecond = 1000;

const sweptAtMostEveryMs = 60_000;

const keptAfterItsEndMs = 86_400_000;

export interface HashedAdapting {
  readonly rows: ProviderRows;
  readonly now: () => number;
}

function storedPayloadOf({ jti: _jti, session, ...payload }: AdapterPayload): string {
  if (session === undefined) {
    return JSON.stringify(payload);
  }
  const { cookie: _cookie, ...kept } = session;
  return JSON.stringify({ ...payload, session: kept });
}

function payloadOf(id: string | undefined, stored: StoredPayload | undefined): AdapterPayload | undefined {
  if (stored === undefined) {
    return undefined;
  }
  const payload = payloadFromJson(stored.payload);
  return {
    ...payload,
    ...(id === undefined ? {} : { jti: id }),
    ...(stored.consumedAt === undefined ? {} : { consumed: Math.floor(stored.consumedAt / millisecondsInASecond) }),
  };
}

function textOrUndefined(value: unknown): string | undefined {
  return Predicate.isString(value) ? value : undefined;
}

function sweeping({ rows, now }: HashedAdapting): () => Promise<void> {
  const last = { sweptAt: Number.NEGATIVE_INFINITY };
  return async () => {
    const at = now();
    if (at - last.sweptAt < sweptAtMostEveryMs) {
      return;
    }
    last.sweptAt = at;
    await rows.swept(at - keptAfterItsEndMs);
  };
}

const modelsOfAGrant = ['AccessToken', 'AuthorizationCode', 'RefreshToken'];

async function grantEnded(rows: ProviderRows, grantId: string): Promise<void> {
  await Promise.all(modelsOfAGrant.map((model) => rows.revokedByGrant(model, grantId)));
  await rows.destroyed({ model: 'Grant', sha256: sha256Of(grantId) });
}

function adapterOf(model: string, adapting: HashedAdapting, swept: () => Promise<void>): Adapter {
  const { rows, now } = adapting;
  const keyOf = (id: string) => ({ model, sha256: sha256Of(id) });
  return {
    upsert: async (id, payload, expiresIn) => {
      await swept();
      await rows.kept({
        ...keyOf(id),
        payload: storedPayloadOf(payload),
        grantId: textOrUndefined(payload.grantId),
        uid: textOrUndefined(payload.uid),
        expiresAt: expiresIn === undefined ? undefined : now() + expiresIn * millisecondsInASecond,
      });
    },
    find: async (id) => payloadOf(id, await rows.found(keyOf(id))),
    findByUid: async (uid) => payloadOf(undefined, await rows.foundByUid(model, uid)),
    findByUserCode: () => Promise.resolve(),
    consume: async (id) => {
      if (await rows.consumed(keyOf(id), now())) {
        return;
      }
      const { grantId } = (await rows.found(keyOf(id))) ?? {};
      if (grantId !== undefined) {
        await grantEnded(rows, grantId);
      }
      throw new errors.InvalidGrant('grant request is invalid');
    },
    destroy: async (id) => {
      await rows.destroyed(keyOf(id));
    },
    revokeByGrantId: async (grantId) => {
      await rows.revokedByGrant(model, grantId);
    },
  };
}

export function hashedAdapterOf(adapting: HashedAdapting): AdapterFactory {
  const swept = sweeping(adapting);
  return (model) => adapterOf(model, adapting, swept);
}

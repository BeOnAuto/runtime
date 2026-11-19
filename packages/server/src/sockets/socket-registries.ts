import { createHmac, randomBytes } from 'node:crypto';

import {
  connectionsStream,
  socketsHeldIn,
  type HeldSockets,
  type SecretKeeping,
  type SocketHolder,
  type SocketRegistries,
} from '@on.auto/connections';
import type { LedgerStreams } from '@on.auto/ledger';
import { socketKeyOf, type SocketOpening } from '@on.auto/providers';
import { Effect, Redacted } from 'effect';

export interface RegistryParts {
  readonly streams: Pick<LedgerStreams, 'orgStreams'>;
  readonly registries: SocketRegistries;
  readonly secrets: Pick<SecretKeeping, 'read'>;
}

export interface SocketMember {
  readonly org: string;
  readonly holder: SocketHolder;
}

export interface WantedSocket {
  readonly key: string;
  readonly provider: string;
  readonly opening: SocketOpening;
  readonly members: readonly SocketMember[];
}

interface KeptValue {
  readonly digest: string;
  readonly value: Redacted.Redacted;
}

interface HeldValue extends KeptValue, SocketMember {}

const registryWords = {
  unread:
    'The app credential of a connection could not be read from the secret store, so its socket waits for the next round',
} as const;

export function memberKeyOf({ org, holder }: SocketMember): string {
  return JSON.stringify([org, holder.connection, holder.connectedAt, holder.credential]);
}

function openingOf({ destination, failureCodes }: SocketHolder, credential: Redacted.Redacted): SocketOpening {
  return failureCodes === undefined ? { destination, credential } : { destination, credential, failureCodes };
}

function wantedOf(held: readonly HeldValue[]): ReadonlyMap<string, WantedSocket> {
  const sockets = new Map<string, WantedSocket>();
  for (const { org, holder, digest, value } of held) {
    const key = socketKeyOf({ provider: holder.provider, at: holder.at, digest });
    const members = [...(sockets.get(key)?.members ?? []), { org, holder }];
    sockets.set(key, { key, provider: holder.provider, opening: openingOf(holder, value), members });
  }
  return sockets;
}

class HeldRegistries {
  readonly #parts: RegistryParts;
  readonly #hashed = randomBytes(32);
  readonly #held = new Map<string, HeldSockets>();
  readonly #values = new Map<string, KeptValue>();

  constructor(parts: RegistryParts) {
    this.#parts = parts;
  }

  readonly wanted: Effect.Effect<ReadonlyMap<string, WantedSocket>, unknown> = Effect.gen({ self: this }, function* () {
    const listed = yield* Effect.tryPromise(() => this.#parts.streams.orgStreams(connectionsStream));
    const listedOrgs = new Set(listed.map(({ org }) => org));
    for (const org of this.#held.keys()) {
      if (!listedOrgs.has(org)) {
        this.#held.delete(org);
      }
    }
    for (const { org, version } of listed) {
      if (this.#held.get(org)?.version !== version) {
        this.#held.set(org, yield* socketsHeldIn(this.#parts.registries, org));
      }
    }
    const members = [...this.#held].flatMap(([org, { holders }]: readonly [string, HeldSockets]) =>
      holders.map((holder) => ({ org, holder })),
    );
    const valued = yield* Effect.forEach(members, (member: SocketMember) => this.#valued(member));
    this.#forgetValuesBut(new Set(members.map((member: SocketMember) => member.holder.secretId)));
    return wantedOf(valued.flat());
  });

  #valued({ org, holder }: SocketMember): Effect.Effect<readonly HeldValue[]> {
    const kept = this.#values.get(holder.secretId);
    if (kept !== undefined) {
      return Effect.succeed([{ org, holder, ...kept }]);
    }
    return this.#parts.secrets.read(holder.secretId).pipe(
      Effect.map((row): readonly HeldValue[] => {
        if (row === undefined) {
          return [];
        }
        const digest = createHmac('sha256', this.#hashed).update(Redacted.value(row.value)).digest('base64url');
        this.#values.set(holder.secretId, { digest, value: row.value });
        return [{ org, holder, digest, value: row.value }];
      }),
      Effect.catch(() =>
        Effect.logWarning(registryWords.unread).pipe(
          Effect.annotateLogs({ org, connection: holder.connection }),
          Effect.andThen(Effect.sync(() => this.#held.delete(org))),
          Effect.as([]),
        ),
      ),
    );
  }

  #forgetValuesBut(inUse: ReadonlySet<string>): void {
    for (const secretId of this.#values.keys()) {
      if (!inUse.has(secretId)) {
        this.#values.delete(secretId);
      }
    }
  }
}

export function registriesOf(parts: RegistryParts): HeldRegistries {
  return new HeldRegistries(parts);
}

import type { StreamReader, StreamWriter } from '@on.auto/operations';
import { makeConsentClient, type ConsentClient, type ConsentClientOptions } from '@on.auto/tool-servers';
import { DateTime, Effect, Option, Redacted } from 'effect';

import type { Claim, KeptSecret, Replacement, SecretKeeping } from '../operations/connection-services.ts';
import { makeClientRegistrations } from '../registrations/client-registrations.ts';

export interface HarnessConsenting {
  readonly beforeKeeping?: (() => Promise<unknown>) | undefined;
  readonly mostSecretCharacters?: number | undefined;
  readonly consenting?: Partial<ConsentClientOptions> | undefined;
}

type Keeping = Omit<HarnessConsenting, 'consenting'>;

export interface KeptSecrets extends SecretKeeping {
  readonly values: () => ReadonlyMap<string, string>;
  readonly endings: () => ReadonlyMap<string, string>;
}

interface Row {
  readonly text: string;
  readonly version: number;
  readonly claimedUntil: number | undefined;
}

interface Rows {
  readonly rows: Map<string, Row>;
  readonly endings: Map<string, string>;
}

const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis);

function isoOf(moment: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(moment));
}

function openClaimOf(row: Row, moment: number): number | undefined {
  return row.claimedUntil !== undefined && row.claimedUntil > moment ? row.claimedUntil : undefined;
}

function keptSecretOf(row: Row, moment: number): KeptSecret {
  const until = openClaimOf(row, moment);
  return {
    value: Redacted.make(row.text),
    version: row.version,
    claimedUntil: until === undefined ? undefined : isoOf(until),
  };
}

function tooLarge(mostSecretCharacters: number) {
  return Effect.fail({ detail: `A secret to keep holds more than ${mostSecretCharacters} characters` });
}

function readOf({ rows }: Readonly<Rows>): SecretKeeping['read'] {
  return (id) =>
    Effect.map(nowMillis, (moment) =>
      Option.getOrUndefined(Option.map(Option.fromNullishOr(rows.get(id)), (row) => keptSecretOf(row, moment))),
    );
}

function replaceOf({ rows, endings }: Readonly<Rows>, mostSecretCharacters: number): SecretKeeping['replace'] {
  return (id, version, value) =>
    Effect.suspend(() => {
      const text = Redacted.value(value);
      if (text.length > mostSecretCharacters) {
        return tooLarge(mostSecretCharacters);
      }
      if (rows.get(id)?.version !== version) {
        return Effect.succeed<Replacement>({ replaced: false });
      }
      rows.set(id, { text, version: version + 1, claimedUntil: undefined });
      endings.delete(id);
      return Effect.succeed<Replacement>({ replaced: true, version: version + 1 });
    });
}

function claimOf({ rows }: Readonly<Rows>): SecretKeeping['claim'] {
  return (id, version, lastingMs) =>
    Effect.map(nowMillis, (moment): Claim => {
      const row = rows.get(id);
      if (row?.version !== version || openClaimOf(row, moment) !== undefined) {
        return { claimed: false };
      }
      rows.set(id, { ...row, claimedUntil: moment + lastingMs });
      return { claimed: true, until: isoOf(moment + lastingMs) };
    });
}

export function keptSecrets({
  beforeKeeping = () => Promise.resolve(),
  mostSecretCharacters = 64,
}: Keeping): KeptSecrets {
  const held: Rows = { rows: new Map(), endings: new Map() };
  const { rows, endings } = held;
  return {
    keep: (value, endsWith) =>
      Effect.andThen(Effect.promise(beforeKeeping), () => {
        const text = Redacted.value(value);
        if (text.length > mostSecretCharacters) {
          return tooLarge(mostSecretCharacters);
        }
        const id = `secret-${rows.size + 1}`;
        rows.set(id, { text, version: 1, claimedUntil: undefined });
        if (endsWith !== undefined) {
          endings.set(id, endsWith);
        }
        return Effect.succeed(id);
      }),
    read: readOf(held),
    replace: replaceOf(held, mostSecretCharacters),
    claim: claimOf(held),
    endingsOf: (ids) =>
      Effect.sync(() => new Map([...endings].filter(([id]: readonly [string, string]) => ids.includes(id)))),
    forget: (id) =>
      Effect.sync(() => {
        rows.delete(id);
        endings.delete(id);
      }),
    values: () => new Map([...rows].map(([id, row]: readonly [string, Row]) => [id, row.text])),
    endings: () => new Map(endings),
  };
}

export function harnessConsentOf(
  registry: StreamReader & StreamWriter,
  secrets: SecretKeeping,
  consenting: Partial<ConsentClientOptions> = {},
): ConsentClient {
  return makeConsentClient({
    fetch: globalThis.fetch,
    registeredClients: [],
    publicUrl: undefined,
    registrations: makeClientRegistrations({ registry, secrets }),
    ...consenting,
  });
}

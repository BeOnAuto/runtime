import { makeAppRuntime } from '@on.auto/api';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Conflict, type StreamReader, type StreamWriter } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { sealedSecretStoreOn, secretStoreOn, type SecretRows, type SecretStore } from '@on.auto/secrets';
import {
  custodianRefusal,
  memoryKeeper,
  memoryKeeperRefusal,
  memoryRows,
  recordingCustodian,
  type RecordingCustodian,
} from '@on.auto/secrets/testing';
import { DateTime, Effect, Redacted, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { applicationLayer } from '../composition/application-layer.ts';
import {
  ownKeysDecider,
  ownKeysStream,
  retryStateKeysKeptBy,
  retryStateKeysOf,
  secretsKeptBy,
  type OwnKeyEvent,
  type OwnKeyKeeping,
} from './own-keys.ts';

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

const at = '2026-10-20T09:00:00.000Z';

const keeping: OwnKeyKeeping = { purpose: 'retry_state', secret_id: 'secret-1', by: 'runtime', at };

type Started = Parameters<typeof retryStateKeysKeptBy>;

const fromTheEnvironment: Started[1] = secretsKeptBy({
  secrets: {
    current: { from: 'environment', setting: 'SECRETS_KEY', key: Redacted.make(new Uint8Array(32)) },
    previous: undefined,
  },
  keepers: { current: { kind: 'ledger', setting: 'SECRETS_KEEPER' }, previous: undefined },
});

const inTheManager: Started[1] = secretsKeptBy({
  secrets: undefined,
  keepers: {
    current: {
      kind: 'aws-parameter-store',
      setting: 'SECRETS_KEEPER',
      prefix: '/auto-runtime/secrets',
      region: 'eu-west-1',
      regionSetting: 'AWS_REGION',
    },
    previous: undefined,
  },
});

function started(services: Started[0]) {
  return retryStateKeysKeptBy(services, fromTheEnvironment);
}

const waysOut =
  "Start the server with the key the ledger's secrets were sealed under, or give that key as SECRETS_KEY_PREVIOUS, SECRETS_KEY_FILE_PREVIOUS or SECRETS_KEY_KMS_PREVIOUS beside a new key";

function storeOver(rows: SecretRows, custodian: RecordingCustodian): SecretStore {
  return sealedSecretStoreOn(rows, { current: custodian });
}

function bytesOf(key: Redacted.Redacted<Uint8Array> | undefined): readonly number[] {
  return key === undefined ? [] : Array.from(Redacted.value(key));
}

const collecting = {
  ...ownKeysDecider,
  initialState: [],
  evolve: (facts: readonly unknown[], fact: unknown) => [...facts, fact],
};

async function factsIn(ledger: MemoryLedger): Promise<readonly unknown[]> {
  return (await Effect.runPromise(ledger.service.load(ownKeysStream, collecting))).state;
}

function recordedFirstBy(ledger: MemoryLedger, otherStart: Effect.Effect<unknown>): StreamReader & StreamWriter {
  const raced = { yet: false };
  const racedOnce = Effect.suspend(() => {
    const first = !raced.yet;
    raced.yet = true;
    return first ? otherStart : Effect.void;
  });
  return {
    ...ledger.service,
    execute: (stream, decider, command, lineage) =>
      Effect.andThen(racedOnce, ledger.service.execute(stream, decider, command, lineage)),
  };
}

function failureOf(start: Effect.Effect<unknown, { readonly message: string }>): Promise<string> {
  return Effect.runPromise(Effect.map(Effect.flip(start), String));
}

describe('the decider of the keys the runtime keeps for itself', () => {
  it('records a key for a purpose that has none, by whoever keeps it, and refuses a second for a purpose that has one', () => {
    const kept = ownKeysDecider.evolve(ownKeysDecider.initialState, {
      type: 'own_key_kept',
      data: { purpose: 'retry_state', secret_id: 'secret-1' },
      context: { by: 'runtime', at },
    });

    expect(ownKeysDecider.decide(keeping, ownKeysDecider.initialState)).toEqual(
      Result.succeed([{ type: 'own_key_kept', data: { purpose: 'retry_state', secret_id: 'secret-1' } }]),
    );
    expect(ownKeysDecider.decide({ ...keeping, secret_id: 'secret-2' }, kept)).toEqual(
      Result.fail(new Conflict({ kind: 'taken', detail: 'The runtime keeps a key for retry_state already' })),
    );
    expect(ownKeysDecider.context(keeping, kept)).toEqual({ by: 'runtime', at });
  });

  it('folds the keys by purpose, the latest last', () => {
    const facts: readonly OwnKeyEvent[] = ['secret-1', 'secret-2'].map((secretId) => ({
      type: 'own_key_kept',
      data: { purpose: 'retry_state', secret_id: secretId },
      context: { by: 'runtime', at },
    }));

    const folded = facts.reduce((keys, fact) => ownKeysDecider.evolve(keys, fact), ownKeysDecider.initialState);

    expect([...folded]).toEqual([['retry_state', 'secret-2']]);
  });
});

describe('the key that signs the state of a retry', () => {
  it('is 32 random bytes kept in the secret store at the first start and recorded by the runtime, and the same at the next, with one fact and one row', async () => {
    const ledger = memoryLedger();
    const rows = memoryRows({ now });
    const services = { registry: ledger.service, secrets: storeOver(rows, recordingCustodian()) };

    const first = await Effect.runPromise(started(services));
    const next = await Effect.runPromise(started(services));

    expect(bytesOf(first.current)).toHaveLength(32);
    expect(bytesOf(next.current)).toEqual(bytesOf(first.current));
    expect([first.previous, next.previous]).toEqual([undefined, undefined]);
    expect(await factsIn(ledger)).toMatchObject([
      {
        type: 'own_key_kept',
        data: { purpose: 'retry_state', secret_id: rows.kept()[0]?.id },
        context: { by: 'runtime' },
      },
    ]);
    expect(rows.kept()).toHaveLength(1);
  });

  it('is the key another server recorded first, while the one this server kept meanwhile is forgotten', async () => {
    const ledger = memoryLedger();
    const rows = memoryRows({ now });
    const custodian = recordingCustodian();
    const other = { registry: ledger.service, secrets: storeOver(rows, custodian) };
    const registry = recordedFirstBy(ledger, Effect.orDie(started(other)));

    const taken = await Effect.runPromise(started({ registry, secrets: storeOver(rows, custodian) }));
    const theirs = await Effect.runPromise(started(other));

    expect(bytesOf(taken.current)).toEqual(bytesOf(theirs.current));
    expect(await factsIn(ledger)).toHaveLength(1);
    expect(rows.kept()).toHaveLength(1);
  });
});

describe('a start that cannot have the key that signs the state of a retry', () => {
  it('stops, naming the purpose and the words of the store, when the row is sealed under a key it does not have', async () => {
    const ledger = memoryLedger();
    const rows = memoryRows({ now });
    const sealing = recordingCustodian();
    await Effect.runPromise(started({ registry: ledger.service, secrets: storeOver(rows, sealing) }));

    const refused = await failureOf(
      started({ registry: ledger.service, secrets: storeOver(rows, recordingCustodian()) }),
    );

    expect(refused).toBe(
      `OwnKeyUnavailable: The key the runtime keeps for retry_state cannot be read under the key that SECRETS_KEY holds: The secret is sealed under the key ${sealing.kid}, which is neither the current key nor the previous one. ${waysOut}`,
    );
    expect(await factsIn(ledger)).toHaveLength(1);
  });
});

describe('a start whose key that signs the state of a retry is gone or kept nowhere', () => {
  it('stops when the row is gone, or holds something other than 32 bytes, and keeps no second key', async () => {
    const [gone, other] = [memoryLedger(), memoryLedger()];
    const rows = memoryRows({ now });
    const store = storeOver(rows, recordingCustodian());
    await Effect.runPromise(started({ registry: gone.service, secrets: store }));
    await Effect.runPromise(store.forget(String(rows.kept()[0]?.id)));
    const notAKey = await Effect.runPromise(store.keep(Redacted.make('not a key')));
    await Effect.runPromise(other.service.execute(ownKeysStream, ownKeysDecider, { ...keeping, secret_id: notAKey }));

    const refusals = [
      await failureOf(started({ registry: gone.service, secrets: store })),
      await failureOf(started({ registry: other.service, secrets: store })),
    ];

    expect(refusals).toEqual([
      'OwnKeyUnavailable: The key the runtime keeps for retry_state is no longer in the secret store, so the server does not start',
      'OwnKeyUnavailable: The key the runtime keeps for retry_state holds something other than 32 bytes, so the server does not start',
    ]);
    expect(rows.kept()).toHaveLength(1);
  });

  it('stops at the first start when the secret store cannot keep it, and records nothing', async () => {
    const ledger = memoryLedger();
    const custodian = recordingCustodian();
    custodian.refuse();

    const refused = await failureOf(
      started({ registry: ledger.service, secrets: storeOver(memoryRows({ now }), custodian) }),
    );

    expect(refused).toBe(
      `OwnKeyUnavailable: The key the runtime keeps for retry_state cannot be kept under the key that SECRETS_KEY holds, so the server does not start: The custodian of the key ${custodian.kid} refused to wrap a data key: ${custodianRefusal}`,
    );
    expect(await factsIn(ledger)).toEqual([]);
  });
});

describe('a start under a secret manager that cannot have the key that signs the state of a retry', () => {
  it("stops in words that name the manager and its prefix, the store's words and the way out, where the key cannot be kept or read", async () => {
    const [ledger, other] = [memoryLedger(), memoryLedger()];
    const rows = memoryRows({ now });
    const keeper = memoryKeeper();
    keeper.refuse();
    const unkept = await failureOf(
      retryStateKeysKeptBy(
        { registry: ledger.service, secrets: secretStoreOn(rows, { current: keeper }) },
        inTheManager,
      ),
    );
    await Effect.runPromise(started({ registry: other.service, secrets: storeOver(rows, recordingCustodian()) }));

    const unread = await failureOf(
      retryStateKeysKeptBy(
        { registry: other.service, secrets: secretStoreOn(rows, { current: memoryKeeper() }) },
        inTheManager,
      ),
    );

    expect(unkept).toBe(
      `OwnKeyUnavailable: The key the runtime keeps for retry_state cannot be kept in AWS Parameter Store under /auto-runtime/secrets in eu-west-1, so the server does not start: ${memoryKeeperRefusal}`,
    );
    expect(unread).toBe(
      "OwnKeyUnavailable: The key the runtime keeps for retry_state cannot be read in AWS Parameter Store under /auto-runtime/secrets in eu-west-1: The secret is kept by the keeper ledger, which is neither the current keeper nor the previous one. Start the server with the keeper the ledger's secrets were kept by, or name that keeper as SECRETS_KEEPER_PREVIOUS beside SECRETS_KEEPER",
    );
  });
});

async function aRuntime() {
  const runtime = await makeAppRuntime(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
  onTestFinished(() => runtime.dispose());
  return runtime;
}

function closingCounted(store: SecretStore) {
  const closes = { made: 0 };
  const counted: SecretStore = {
    ...store,
    close: () => {
      closes.made += 1;
      return store.close();
    },
  };
  return { closes, counted };
}

describe('the start of a server that reads the key that signs the state of a retry', () => {
  it('closes its secret store before it fails, and leaves it open once it has the key', async () => {
    const refusing = recordingCustodian();
    refusing.refuse();
    const failing = closingCounted(storeOver(memoryRows({ now }), refusing));
    const answering = closingCounted(storeOver(memoryRows({ now }), recordingCustodian()));

    const failed = retryStateKeysOf(await aRuntime(), failing.counted, fromTheEnvironment);
    await expect(failed).rejects.toThrow('cannot be kept under the key that SECRETS_KEY holds');
    const kept = await retryStateKeysOf(await aRuntime(), answering.counted, fromTheEnvironment);

    expect(failing.closes.made).toBe(1);
    expect([bytesOf(kept.current).length, answering.closes.made]).toEqual([32, 0]);
  });
});

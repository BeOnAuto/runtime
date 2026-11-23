import type { RsaSigningKey } from '@on.auto/identity';
import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Conflict, type StreamReader, type StreamWriter } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { sealedSecretStoreOn, type SecretRows, type SecretStore } from '@on.auto/secrets';
import { memoryRows, recordingCustodian, type RecordingCustodian } from '@on.auto/secrets/testing';
import { DateTime, Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  SubjectTokenKeyEventSchema,
  subjectTokenKeyDecider,
  subjectTokenKeyKeptBy,
  subjectTokenKeyStream,
  type SubjectTokenKeyEvent,
  type SubjectTokenKeyServices,
} from './subject-token-key.ts';

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

const at = '2026-11-23T09:00:00.000Z';

function keysMadeInTurn(): () => Promise<RsaSigningKey> {
  const made = { count: 0 };
  return () => {
    made.count += 1;
    const n = `modulus-${String(made.count)}`;
    return Promise.resolve({ kty: 'RSA', n, e: 'AQAB', d: 'd', p: 'p', q: 'q', dp: 'dp', dq: 'dq', qi: 'qi' });
  };
}

function storeOver(rows: SecretRows, custodian: RecordingCustodian): SecretStore {
  return sealedSecretStoreOn(rows, { current: custodian });
}

const collecting = {
  ...subjectTokenKeyDecider,
  initialState: [],
  evolve: (facts: readonly unknown[], fact: unknown) => [...facts, fact],
};

async function factsIn(ledger: MemoryLedger): Promise<readonly unknown[]> {
  return (await Effect.runPromise(ledger.service.load(subjectTokenKeyStream, collecting))).state;
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

function kept(services: SubjectTokenKeyServices): Promise<RsaSigningKey> {
  return Effect.runPromise(subjectTokenKeyKeptBy(services));
}

async function forgottenIn(sealing: SecretStore, _rows: SecretRows, lostId: string): Promise<SecretStore> {
  await Effect.runPromise(sealing.forget(lostId));
  return sealing;
}

function sealedElsewhereThan(_sealing: SecretStore, rows: SecretRows): Promise<SecretStore> {
  return Promise.resolve(storeOver(rows, recordingCustodian()));
}

const taken = new Conflict({ kind: 'taken', detail: 'The runtime keeps a key for subject tokens already' });

describe('the decider of the key the runtime signs subject tokens with', () => {
  const recorded = Result.succeed([{ type: 'subject_token_signing_key_kept', data: { secret_id: 'secret-3' } }]);

  it.each([
    ['records the first key where none is kept', undefined, undefined, () => recorded],
    ['records a key in place of the one kept', 'secret-1', 'secret-1', () => recorded],
    ['refuses a first key where one is kept', 'secret-1', undefined, () => Result.fail(taken)],
    ['refuses a key in place of one no longer kept', 'secret-2', 'secret-1', () => Result.fail(taken)],
  ])('%s', (_case, keptBefore, inPlaceOf, decided) => {
    const keeping = { secret_id: 'secret-3', in_place_of: inPlaceOf, by: 'runtime', at };

    expect(subjectTokenKeyDecider.decide(keeping, keptBefore)).toEqual(decided());
    expect(subjectTokenKeyDecider.context(keeping, keptBefore)).toEqual({ by: 'runtime', at });
  });

  it('folds to the key recorded last', () => {
    const facts: readonly SubjectTokenKeyEvent[] = ['secret-1', 'secret-2'].map((secretId) => ({
      type: 'subject_token_signing_key_kept',
      data: { secret_id: secretId },
      context: { by: 'runtime', at },
    }));

    const folded = facts.reduce(
      (current, fact) => subjectTokenKeyDecider.evolve(current, fact),
      subjectTokenKeyDecider.initialState,
    );

    expect(folded).toBe('secret-2');
  });
});

describe('the key the runtime signs subject tokens with', () => {
  it('is made at the first start, kept in the secret store, recorded by the runtime, and read again at the next start', async () => {
    const ledger = memoryLedger();
    const rows = memoryRows({ now });
    const services = {
      registry: ledger.service,
      secrets: storeOver(rows, recordingCustodian()),
      made: keysMadeInTurn(),
    };

    const first = await kept(services);
    const next = await kept(services);

    expect(first.n).toBe('modulus-1');
    expect(next).toEqual(first);
    expect(await factsIn(ledger)).toMatchObject([
      { type: 'subject_token_signing_key_kept', data: { secret_id: rows.kept()[0]?.id }, context: { by: 'runtime' } },
    ]);
    expect(rows.kept()).toHaveLength(1);
  });

  it('is the key another server recorded first, while the secret this server kept meanwhile is forgotten', async () => {
    const ledger = memoryLedger();
    const rows = memoryRows({ now });
    const custodian = recordingCustodian();
    const made = keysMadeInTurn();
    const other = { registry: ledger.service, secrets: storeOver(rows, custodian), made };
    const registry = recordedFirstBy(ledger, Effect.orDie(subjectTokenKeyKeptBy(other)));

    const ours = await kept({ registry, secrets: storeOver(rows, custodian), made });
    const theirs = await kept(other);

    expect(ours).toEqual(theirs);
    expect(await factsIn(ledger)).toHaveLength(1);
    expect(rows.kept()).toHaveLength(1);
  });
});

describe('the key the runtime signs subject tokens with, where the one kept cannot be read or none can be kept', () => {
  it.each([
    ['is gone from the secret store', forgottenIn, 0],
    ['is sealed under a key the secret store no longer has', sealedElsewhereThan, 1],
  ])('is made anew and recorded in place of the one kept, where that one %s', async (_case, lose, rowsLeft) => {
    const ledger = memoryLedger();
    const rows = memoryRows({ now });
    const made = keysMadeInTurn();
    const sealing = storeOver(rows, recordingCustodian());
    const lost = await kept({ registry: ledger.service, secrets: sealing, made });
    const lostId = String(rows.kept()[0]?.id);
    const store = await lose(sealing, rows, lostId);

    const anew = await kept({ registry: ledger.service, secrets: store, made });
    const again = await kept({ registry: ledger.service, secrets: store, made });

    expect(anew.n).not.toBe(lost.n);
    expect(again).toEqual(anew);
    expect(await factsIn(ledger)).toHaveLength(2);
    expect(rows.kept().filter(({ id }) => id === lostId)).toHaveLength(rowsLeft);
  });

  it('is not made where the secret store cannot keep it, and nothing is recorded', async () => {
    const ledger = memoryLedger();
    const custodian = recordingCustodian();
    custodian.refuse();

    const refused = await Effect.runPromise(
      Effect.flip(
        subjectTokenKeyKeptBy({
          registry: ledger.service,
          secrets: storeOver(memoryRows({ now }), custodian),
          made: keysMadeInTurn(),
        }),
      ),
    );

    expect(refused).toBeInstanceOf(Error);
    expect(await factsIn(ledger)).toEqual([]);
  });
});

describe('the facts of the key the runtime signs subject tokens with', () => {
  recordedFactsBehaviour({
    schema: SubjectTokenKeyEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.73.0': [
        {
          type: 'subject_token_signing_key_kept',
          data: { secret_id: '019ab1d4-6f2a-7c3e-8b5d-4e9f0a1c2d3e' },
          context: { at: '2026-11-23T09:00:00.000Z', by: 'runtime' },
        },
      ],
    },
  });
});

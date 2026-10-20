import { Effect, Fiber, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import type { SecretStore } from '../store/secret-store.ts';
import { aSecretsKey, custodianRefusal, recordingCustodian, type RecordingCustodian } from './recording-custodian.ts';
import { kept, kidOf, readBack, rowsIn, storeOn, storeWith, type SecretsEntry } from './secrets-entry.ts';

function unknownKeyRefused(entry: SecretsEntry): void {
  it('cannot read a value sealed under another key, and names that key and never the value', async () => {
    const database = await entry.aDatabase();
    const sealing = aSecretsKey();
    const id = await kept(await storeOn(entry, database, { current: sealing }), 'pasted-key');
    const other = await storeOn(entry, database, { current: aSecretsKey() });

    const refused = await Effect.runPromise(Effect.flip(other.read(id)));

    expect(refused).toMatchObject({
      _tag: 'secret_key_unknown',
      kid: kidOf(sealing),
      detail: `The secret is sealed under the key ${kidOf(sealing)}, which is neither the current key nor the previous one`,
    });
    expect(JSON.stringify(refused)).not.toContain('pasted-key');
  });
}

function refusedTo(custodian: RecordingCustodian, act: string) {
  return {
    _tag: 'custodian_refused',
    kid: custodian.kid,
    detail: `The custodian of the key ${custodian.kid} refused to ${act} a data key: ${custodianRefusal}`,
  };
}

function custodianRefusing(entry: SecretsEntry): void {
  it('keeps nothing, as a value or as a replacement, whose data key the custodian refuses to wrap, failing in its words', async () => {
    const database = await entry.aDatabase();
    const custodian = recordingCustodian();
    const store = await storeWith(entry, database, { current: custodian });
    const id = await kept(store, 'pasted-key');
    const before = await rowsIn(entry, database);

    custodian.refuse();
    const [keeping, replacing] = await Effect.runPromise(
      Effect.all([
        Effect.flip(store.keep(Redacted.make('second-key'))),
        Effect.flip(store.replace(id, 1, Redacted.make('renewed-key'))),
      ]),
    );

    expect(keeping).toMatchObject(refusedTo(custodian, 'wrap'));
    expect(replacing).toMatchObject(refusedTo(custodian, 'wrap'));
    expect(await rowsIn(entry, database)).toEqual(before);
  });
}

function readStalled(store: SecretStore, id: string, custodian: RecordingCustodian) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const asked = custodian.stall();
      const reading = yield* Effect.forkChild(Effect.flip(store.read(id)));
      yield* Effect.promise(() => asked);
      yield* TestClock.adjust('29999 millis');
      const before = reading.pollUnsafe();
      yield* TestClock.adjust('1 millis');
      return { before, failure: yield* Fiber.join(reading) };
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

function unreadableNow(entry: SecretsEntry): void {
  it('cannot read now, in words that name no value, a value whose custodian refuses or does not answer within 30 seconds, and reads it once the custodian answers again', async () => {
    const database = await entry.aDatabase();
    const custodian = recordingCustodian();
    const store = await storeWith(entry, database, { current: custodian });
    const id = await kept(store, 'pasted-key');
    const before = await rowsIn(entry, database);

    custodian.refuse();
    const refused = await Effect.runPromise(Effect.flip(store.read(id)));
    const stalled = await readStalled(store, id, custodian);
    custodian.answer();
    const answered = await readBack(store, id);

    expect(refused).toMatchObject(refusedTo(custodian, 'unwrap'));
    expect(stalled.before).toBeUndefined();
    expect(stalled.failure).toMatchObject({
      _tag: 'keeper_unavailable',
      detail: 'The keeper of the secret, or the custodian of its key, did not answer within 30 seconds',
    });
    expect(answered).toBe('pasted-key');
    expect(JSON.stringify([refused, stalled])).not.toContain('pasted-key');
    expect(await rowsIn(entry, database)).toEqual(before);
  });
}

export function storeFailureBehaviour(entry: SecretsEntry): void {
  describe('the failures of the secret store', () => {
    unknownKeyRefused(entry);
    custodianRefusing(entry);
    unreadableNow(entry);
  });
}

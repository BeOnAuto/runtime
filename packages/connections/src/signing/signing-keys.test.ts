import { signingKeyOf, webhookSignatureOf, type SigningKey } from '@on.auto/identity';
import type { Outcome } from '@on.auto/operations';
import type { SecretReadingFailure } from '@on.auto/tool-servers';
import { DateTime, Effect, Logger, Redacted, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { signingKeysByNameOf, signingKeysOf, type NamedSigningKeys, type SigningReading } from '../index.ts';
import { added, notes } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const givenSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

const firstMoment = '2026-10-15T14:00:00.000Z';

const anHourLater = '2026-10-15T15:00:00.000Z';

const signed = new TextEncoder().encode('{"answer":"approve"}');

function setting(h: Harness, input: unknown, at = firstMoment) {
  return h.call(operationNamed(h.operations, 'set_connection_signing_secret'), ada, input, at);
}

function keyOf(secret: string): SigningKey {
  const key = signingKeyOf(secret);
  if (key === undefined) {
    throw new Error('the test secret is no signing secret');
  }
  return key;
}

const MadeSchema = Schema.Struct({ output: Schema.Struct({ secret: Schema.String }) });

function madeIn(outcome: Outcome): string {
  return Schema.decodeUnknownSync(MadeSchema)(outcome).output.secret;
}

function signatureBy(key: SigningKey): string {
  return webhookSignatureOf(key, 'msg_1', 1, signed);
}

function readingIn(h: Harness, secrets: SigningReading['secrets'] = h.secrets): SigningReading {
  return { ledger: h.ledger.service, secrets };
}

async function readAt(reading: SigningReading, name: string, at: string) {
  const read = signingKeysOf(reading);
  const logged: string[] = [];
  const signing = await Effect.runPromise(
    TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
      Effect.andThen(read('acme', name)),
      Effect.provide(TestClock.layer()),
      Effect.provide(
        Logger.layer([
          Logger.map(Logger.formatJson, (line) => {
            logged.push(line);
          }),
        ]),
      ),
    ),
  );
  return { keys: signing?.keys ?? [], signing, logged };
}

async function byNameAt(reading: SigningReading, at: string) {
  const read = signingKeysByNameOf(reading);
  const byName = await Effect.runPromise(
    TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
      Effect.andThen(read('acme')),
      Effect.provide(TestClock.layer()),
    ),
  );
  return [...byName].map(([name, { connection, keys }]: readonly [string, NamedSigningKeys]) => [
    name,
    connection,
    keys.map(({ secretId, key }) => [secretId, signatureBy(key)]),
  ]);
}

async function keysAt(reading: SigningReading, name: string, at: string) {
  return (await readAt(reading, name, at)).keys;
}

async function signingAt(reading: SigningReading, name: string, at: string) {
  return (await readAt(reading, name, at)).signing;
}

describe('the keys a connection verifies a delivery with', () => {
  it('are the key of its signing secret, found by its name', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await setting(h, { id, secret: givenSecret });

    const signing = await signingAt(readingIn(h), 'notes', anHourLater);

    expect(signing?.connection).toBe(id);
    expect(signing?.keys.map((key) => signatureBy(key))).toEqual([signatureBy(keyOf(givenSecret))]);
  });

  it('are both while the one it replaced still verifies, and the new one alone from the end of its 24 hours', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await setting(h, { id, secret: givenSecret });
    const made = madeIn(await setting(h, { id }, anHourLater));

    const during = await keysAt(readingIn(h), 'notes', '2026-10-16T14:59:59.999Z');
    const after = await keysAt(readingIn(h), 'notes', '2026-10-16T15:00:00.000Z');

    expect(during.map((key) => signatureBy(key))).toEqual([signatureBy(keyOf(made)), signatureBy(keyOf(givenSecret))]);
    expect(after.map((key) => signatureBy(key))).toEqual([signatureBy(keyOf(made))]);
  });

  it('are the connection’s id and none for a connection that holds no signing secret, and nothing for one removed or a name the org has none of', async () => {
    const h = harness();
    const holding = await added(h, notes);
    await setting(h, { id: holding.id, secret: givenSecret });
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: holding.id });
    const tickets = await added(h, { ...notes, name: 'tickets' });

    const signings = await Promise.all(
      ['notes', 'tickets', 'nowhere'].map((name) => signingAt(readingIn(h), name, anHourLater)),
    );

    expect(signings).toEqual([undefined, { connection: tickets.id, keys: [] }, undefined]);
  });
});

describe('the keys of every connection of an org, by name', () => {
  it('are those of each connection that holds a signing secret, each with its secret’s id, the replaced one among them while it verifies, and none of a connection removed or holding none', async () => {
    const h = harness();
    const notesAdded = await added(h, notes);
    await setting(h, { id: notesAdded.id, secret: givenSecret });
    const made = madeIn(await setting(h, { id: notesAdded.id }, anHourLater));
    const tickets = await added(h, { ...notes, name: 'tickets' });
    await setting(h, { id: tickets.id, secret: givenSecret });
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: tickets.id });
    await added(h, { ...notes, name: 'unsigned' });

    const during = await byNameAt(readingIn(h), '2026-10-16T14:59:59.999Z');
    const after = await byNameAt(readingIn(h), '2026-10-16T15:00:00.000Z');

    expect(during).toEqual([
      [
        'notes',
        notesAdded.id,
        [
          ['secret-2', signatureBy(keyOf(made))],
          ['secret-1', signatureBy(keyOf(givenSecret))],
        ],
      ],
    ]);
    expect(after).toEqual([['notes', notesAdded.id, [['secret-2', signatureBy(keyOf(made))]]]]);
  });

  it('are none for an org that holds no connection', async () => {
    expect(await byNameAt(readingIn(harness()), anHourLater)).toEqual([]);
  });
});

describe('a signing secret the store cannot read', () => {
  it('gives no key, and a warning that names why and no secret, as a secret the store no longer keeps or a value that is no signing secret gives none', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await setting(h, { id, secret: givenSecret });
    const unread: SecretReadingFailure = { _tag: 'keeper_unavailable', detail: 'The secret manager did not answer' };

    const { keys: failing, logged } = await readAt(
      readingIn(h, { read: () => Effect.fail(unread) }),
      'notes',
      anHourLater,
    );
    const gone = await keysAt(readingIn(h, { read: () => Effect.undefined }), 'notes', anHourLater);

    const notASecret = await keysAt(
      readingIn(h, {
        read: () => Effect.succeed({ value: Redacted.make('a shared password'), version: 1, claimedUntil: undefined }),
      }),
      'notes',
      anHourLater,
    );

    expect([failing, gone, notASecret]).toEqual([[], [], []]);
    expect(logged.map((line): unknown => JSON.parse(line))).toMatchObject([
      {
        message:
          "A connection's signing secret could not be read, so a delivery signed with it is refused as one signed with no secret",
        annotations: { because: 'The secret manager did not answer' },
      },
    ]);
    expect(logged.join('')).not.toContain(givenSecret);
  });
});

describe('a key read once', () => {
  it('is kept by its secret’s id, so the store is read once for every delivery the secret verifies', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await setting(h, { id, secret: givenSecret });
    const reads: string[] = [];
    const counting = signingKeysOf(
      readingIn(h, {
        read: (secretId) => {
          reads.push(secretId);
          return h.secrets.read(secretId);
        },
      }),
    );

    await Effect.runPromise(Effect.all([counting('acme', 'notes'), counting('acme', 'notes')]));

    expect(reads).toEqual(['secret-1']);
  });
});

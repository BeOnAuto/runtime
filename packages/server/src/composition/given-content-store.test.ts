import { textToKeep } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerDatabaseOf } from '../database/ledger-database.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { ledgerLayerOf } from './ledger-store.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

describe('a ledger given a content store of its own', () => {
  it('keeps what the ledger is given to keep, and reads it back, in the store it is composed with', async () => {
    const store = memoryContentStore();
    const runtime = ManagedRuntime.make(
      ledgerLayerOf(await ledgerDatabaseOf(readSettingsOf({ LEDGER_FILE: ':memory:' })), { content: store }),
    );
    onTestFinished(() => runtime.dispose());

    const kept = await runtime.runPromise(
      Effect.flatMap(Ledger, (ledger) => ledger.content.put(alpha, textToKeep('{"kept":true}', 'application/json'))),
    );

    expect(await Effect.runPromise(store.read(alpha, kept.sha256))).toMatchObject({ bytes: 13 });
  });
});

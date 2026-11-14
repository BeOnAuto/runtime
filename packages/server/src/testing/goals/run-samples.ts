import { sha256Of, type RecordedContent } from '@on.auto/content';
import { Ledger } from '@on.auto/operations';
import { jsonPayloadText, textBytesOf, type PayloadToKeep } from '@on.auto/operations/payloads';
import { Effect, ManagedRuntime, type Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { ledgerLayerOf } from '../../composition/ledger-store.ts';
import { sqliteLedgerDatabase } from '../../database/sqlite-ledger-database.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';

export function keptOf(value: Schema.Json): PayloadToKeep {
  const text = jsonPayloadText(value);
  return { ...text, sha256: sha256Of(text.text), bytes: textBytesOf(text.text) };
}

export async function ledgerContent(): Promise<RecordedContent> {
  const ledger = temporaryLedger();
  const runtime = ManagedRuntime.make(ledgerLayerOf(sqliteLedgerDatabase(ledger.fileName)));
  onTestFinished(async () => {
    await runtime.dispose();
    ledger.remove();
  });
  return (await runtime.runPromise(Effect.service(Ledger))).content;
}

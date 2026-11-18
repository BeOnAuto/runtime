import type { Ledger } from '@on.auto/operations';
import { Layer, Logger, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';

const decodeLogged = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ level: Schema.String, annotations: Schema.Unknown })),
);

type Logged = ReturnType<typeof decodeLogged>;

interface LoggingLayer<Services> {
  readonly layer: Layer.Layer<Services>;
  readonly logged: readonly Logged[];
}

export function loggingLayerOf<Services>(layer: Layer.Layer<Services>): LoggingLayer<Services> {
  const logged: Logged[] = [];
  const logging = Logger.layer([
    Logger.map(Logger.formatJson, (line: string) => {
      const { level, annotations } = decodeLogged(line);
      logged.push({ level, annotations });
    }),
  ]);
  return { layer: layer.pipe(Layer.provide(logging)), logged };
}

interface LoggingLedger {
  readonly ledger: Ledger['Service'];
  readonly logged: readonly Logged[];
}

export async function aLedgerLogging(
  entry: LedgerEntry,
  database: string,
  projections: Parameters<LedgerEntry['ledgerOn']>[2],
): Promise<LoggingLedger> {
  const { layer, logged } = loggingLayerOf(entry.ledgerOn(database, undefined, projections));
  const { ledger, dispose } = await openLedgerWith(layer);
  onTestFinished(dispose);
  return { ledger, logged };
}

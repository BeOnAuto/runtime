import type { Ledger, ProjectedAddress, ProjectedRowsQuery, StreamProjection } from '@on.auto/operations';
import { labelFacts, labelReadModelOf, type LabelFact } from '@on.auto/operations/testing';
import { Effect, Logger, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import type { LedgerEntry, StreamKept } from '../testing/ledger-entry.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';

type AnyLedger = Ledger['Service'];

export const alpha = { org: 'acme', playbook: 'alpha' };

export const beta = { org: 'acme', playbook: 'beta' };

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 1000 };

export async function aStreamLedger(entry: LedgerEntry, database: string, kept?: StreamKept): Promise<AnyLedger> {
  const { ledger, dispose } = await openLedgerWith(
    kept === undefined ? entry.ledgerOn(database) : entry.streamLedgerOn(database, kept),
  );
  onTestFinished(dispose);
  return ledger;
}

export function keptWith(
  projection: StreamProjection = labelReadModelOf(),
  mostBytesFilledAtOnce?: number,
): StreamKept {
  return { streamProjections: [projection], ...(mostBytesFilledAtOnce === undefined ? {} : { mostBytesFilledAtOnce }) };
}

export function labelled(ledger: AnyLedger, stream: string, ...facts: readonly LabelFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, labelFacts, facts));
}

export function set(note: string, ...labels: readonly string[]): LabelFact {
  return { type: 'labels_set', data: { note, labels } };
}

export function added(note: string, label: string): LabelFact {
  return { type: 'label_added', data: { note, label } };
}

const decodeLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.Unknown,
      annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
);

export interface Logged {
  readonly message: string;
  readonly annotations: Readonly<Record<string, unknown>>;
}

export async function readLogged(
  ledger: AnyLedger,
  address: ProjectedAddress = alpha,
): Promise<{ readonly rows: readonly unknown[]; readonly logged: readonly Logged[] }> {
  const logged: Logged[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    const { message, annotations = {} } = decodeLine(line);
    logged.push({ message: String(message), annotations });
  });
  const read = Effect.all([
    ledger.readProjectedRows('label_sets', address, everyRow),
    ledger.readProjectedRows('labelled_rows', address, everyRow),
  ]);
  const [sets, rows] = await Effect.runPromise(read.pipe(Effect.provide(Logger.layer([capture]))));
  return {
    rows: [
      ...sets.map(({ key, row }) => [key, row['labels'], row['set_at']]),
      ...rows.map(({ key, child, row }) => [key, child, row['place'], row['set_at']]),
    ],
    logged,
  };
}

export function builtOf(logged: readonly Logged[]): readonly (readonly unknown[])[] {
  return logged
    .filter(({ annotations }) => annotations['stream'] !== undefined)
    .map(({ annotations }) => [
      annotations['stream'],
      annotations['from'],
      annotations['through'],
      annotations['pages'],
    ]);
}

export async function historyOf(ledger: AnyLedger, playbook: string): Promise<void> {
  await labelled(ledger, `playbook/acme/${playbook}/notes/n1`, set('n1', 'urgent'), added('n1', 'later'));
  await labelled(ledger, `playbook/acme/${playbook}/notes/n2`, set('n2', 'billing'));
  await labelled(ledger, `playbook/acme/${playbook}/notes/n1`, set('n1', 'billing', 'urgent'), added('n1', 'urgent'));
  await labelled(ledger, `playbook/acme/${playbook}/notes/n3`, set('n3', 'not one of its streams'));
}

export const theHistoryFolded = [
  ['n1/1', 1, 1],
  ['n1/3', 2, 3],
  ['n2/1', 1, 1],
  ['n1', 'billing', 1, 3],
  ['n1', 'urgent', 2, 3],
  ['n2', 'billing', 1, 1],
];

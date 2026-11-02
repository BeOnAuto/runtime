import { Effect } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import type { Folder, PassedChange, PassedRow, Reconciling, RowPhase } from './folder.ts';
import {
  definitionsAfter,
  definitionStreamOf,
  noDefinitions,
  type PlaybookDefinitions,
} from './playbook-definitions.ts';

export type KeptDefinitions = (definitionType: string) => Map<string, PlaybookDefinitions>;

export interface DefinitionsKept {
  readonly database: HostDatabase;
  readonly definitions: KeptDefinitions;
}

interface Placed {
  readonly key: string;
  readonly saved: number;
}

function isBuilding({ phase }: PassedRow): boolean {
  return phase === 'waiting' || phase === 'rebuilding';
}

function slotsOf(building: readonly Placed[], rebuildsAtOnce: number): ReadonlySet<string> {
  const inOrderSaved = building.toSorted((one, other) => one.saved - other.saved);
  return new Set(inOrderSaved.slice(0, rebuildsAtOnce).map(({ key }) => key));
}

function phaseIn(slots: ReadonlySet<string>, key: string): RowPhase {
  return slots.has(key) ? 'rebuilding' : 'waiting';
}

export function hasFreeSlot(rows: readonly PassedRow[], rebuildsAtOnce: number): boolean {
  const rebuilding = rows.filter(({ phase }) => phase === 'rebuilding');
  return rebuilding.length < rebuildsAtOnce && rows.some(({ phase }) => phase === 'waiting');
}

function placedOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  row: Row,
): Placed {
  return { key: folder.keyOf(row), saved: row.saved };
}

function changesOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  { database }: DefinitionsKept,
  reconciling: Reconciling,
  rows: readonly Row[],
): readonly Effect.Effect<readonly unknown[], DatabaseFailed>[] {
  const { fresh, dropped } = folder.reconcile(reconciling, rows);
  const leaving = new Set([...fresh.map(({ key }) => key), ...dropped.map((row) => folder.keyOf(row))]);
  const stillBuilding = rows.filter((row) => isBuilding(row) && !leaving.has(folder.keyOf(row)));
  const slots = slotsOf([...stillBuilding.map((row) => placedOf(folder, row)), ...fresh], folder.rebuildsAtOnce);
  const promoted = stillBuilding.filter((row) => row.phase === 'waiting' && slots.has(folder.keyOf(row)));
  return [
    ...promoted.map((row) => database.write(folder.phased(row, 'rebuilding'))),
    ...dropped.map((row) => database.transaction(folder.dropped(row))),
    ...fresh.map(({ key, added }) => database.write(added(phaseIn(slots, key)))),
  ];
}

function phasedBySlots<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  rows: readonly Row[],
): readonly Row[] {
  const building = rows.filter((row) => isBuilding(row)).map((row) => placedOf(folder, row));
  const slots = slotsOf(building, folder.rebuildsAtOnce);
  return rows.map((row) => (isBuilding(row) ? { ...row, phase: phaseIn(slots, folder.keyOf(row)) } : row));
}

function definitionsOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  { database, definitions }: DefinitionsKept,
  playbook: string,
): Effect.Effect<PlaybookDefinitions> {
  const kept = definitions(folder.definitionType);
  const known = kept.get(playbook) ?? noDefinitions;
  return Effect.promise(() =>
    database.store.read(definitionStreamOf(playbook, folder.definitionType), known.version),
  ).pipe(
    Effect.map(({ messages }) => {
      const next = definitionsAfter(known, messages, folder.keptOf);
      kept.set(playbook, next);
      return next;
    }),
  );
}

export function reconciledRows<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  kept: DefinitionsKept,
  playbook: string,
): Effect.Effect<readonly Row[], DatabaseFailed> {
  const { database } = kept;
  return Effect.gen(function* () {
    const definitions = yield* definitionsOf(folder, kept, playbook);
    const before = yield* folder.rowsOf(database, playbook);
    const changes = changesOf(folder, kept, { playbook, definitions }, before);
    yield* Effect.all(changes, { discard: true });
    const rows = changes.length === 0 ? before : yield* folder.rowsOf(database, playbook);
    const phased = phasedBySlots(folder, rows);
    const moved = phased.filter((row, index) => row.phase !== rows[index]?.phase);
    yield* Effect.forEach(moved, (row) => database.write(folder.phased(row, row.phase)), { discard: true });
    return phased;
  });
}

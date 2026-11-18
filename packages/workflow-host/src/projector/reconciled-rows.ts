import { definitionTypeOrder } from '@on.auto/definitions';
import { Effect } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import type { Folder, PassedChange, PassedRow, Reconciling, RowPhase } from './folder.ts';
import { definitionStreamOf, keptKeyOf, noDefinitions, type PlaybookDefinitions } from './playbook-definitions.ts';

export interface KeptDefinitions {
  readonly of: (kept: string) => Map<string, PlaybookDefinitions>;
  readonly placed: (key: string, playbook: string) => void;
}

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
  const { fresh, dropped, renamed = [] } = folder.reconcile(reconciling, rows);
  const leaving = new Set([
    ...fresh.map(({ key }) => key),
    ...[...dropped, ...renamed.map(({ row }) => row)].map((row) => folder.keyOf(row)),
  ]);
  const stillBuilding = rows.filter((row) => isBuilding(row) && !leaving.has(folder.keyOf(row)));
  const slots = slotsOf([...stillBuilding.map((row) => placedOf(folder, row)), ...fresh], folder.rebuildsAtOnce);
  const promoted = stillBuilding.filter((row) => row.phase === 'waiting' && slots.has(folder.keyOf(row)));
  return [
    ...promoted.map((row) => database.write(folder.phased(row, 'rebuilding'))),
    ...renamed.map(({ renamed: statement }) => database.write(statement)),
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

function foldedStream<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  { database, definitions }: DefinitionsKept,
  definitionType: string,
  stream: string,
): Effect.Effect<PlaybookDefinitions> {
  const kept = definitions.of(keptKeyOf(folder, definitionType));
  const known = kept.get(stream) ?? noDefinitions;
  return Effect.promise(() => database.store.read(stream, known.version)).pipe(
    Effect.map(({ messages }) => {
      const next = folder.keptAfter(known, definitionType, messages);
      kept.set(stream, next);
      return next;
    }),
  );
}

function heldStreamsOf(
  { database, definitions }: DefinitionsKept,
  playbook: string,
  definitionType: string,
): Effect.Effect<readonly string[]> {
  return Effect.map(
    Effect.promise(() => database.store.namesHeldIn({ playbookKey: playbook, definitionType })),
    (held) =>
      held.map(({ definitionKey }) => {
        definitions.placed(definitionKey, playbook);
        return definitionStreamOf(definitionKey, definitionType);
      }),
  );
}

function together(every: readonly PlaybookDefinitions[]): PlaybookDefinitions {
  return {
    ...(every[0] ?? noDefinitions),
    version: every.reduce((folded, { version }) => folded + version, 0),
    functions: new Map(every.flatMap(({ functions }) => Array.from(functions))),
  };
}

function ownStreamsOf(playbook: string, definitionType: string): readonly string[] {
  return definitionTypeOrder.includes(definitionType) ? [] : [definitionStreamOf(playbook, definitionType)];
}

function definitionsOfType<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  kept: DefinitionsKept,
  playbook: string,
  definitionType: string,
): Effect.Effect<readonly [string, PlaybookDefinitions]> {
  return Effect.gen(function* () {
    kept.definitions.placed(playbook, playbook);
    const streams = [
      ...ownStreamsOf(playbook, definitionType),
      ...(yield* heldStreamsOf(kept, playbook, definitionType)),
    ];
    const folded = yield* Effect.forEach(streams, (stream) => foldedStream(folder, kept, definitionType, stream));
    const entry: readonly [string, PlaybookDefinitions] = [definitionType, together(folded)];
    return entry;
  });
}

function definitionsOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  kept: DefinitionsKept,
  playbook: string,
): Effect.Effect<PlaybookDefinitions> {
  return Effect.forEach(folder.definitionTypes, (definitionType) =>
    definitionsOfType(folder, kept, playbook, definitionType),
  ).pipe(
    Effect.map((byType: readonly (readonly [string, PlaybookDefinitions])[]) =>
      folder.together(playbook, new Map(byType)),
    ),
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

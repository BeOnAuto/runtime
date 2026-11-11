import {
  addressedStreamOf,
  streamPrefixOfAddress,
  type ProjectedAddress,
  type ProjectedRow,
} from '../projections/keyed-projection.ts';
import { rowsAt, type Table } from '../projections/memory-rows.ts';
import { rowsNotOfTheGreatest } from './stream-checks.ts';
import type { StreamProjection } from './stream-projection.ts';

interface LoggedType {
  readonly stream: string;
  readonly type: string;
}

type RowsOf = (table: string) => readonly ProjectedRow[];

function factsOf(projection: StreamProjection, log: readonly LoggedType[], prefix: string, types: readonly string[]) {
  return log.filter(({ stream, type }) => {
    const named = addressedStreamOf(stream);
    return (
      named?.prefix === prefix &&
      named.kind === projection.kind &&
      projection.streams.includes(named.id) &&
      types.includes(type)
    );
  }).length;
}

function checksFail(projection: StreamProjection, log: readonly LoggedType[], prefix: string, rowsOf: RowsOf): boolean {
  const counts = projection.counted.some(
    ({ projection: table, facts }) => rowsOf(table).length !== factsOf(projection, log, prefix, facts),
  );
  return (
    counts ||
    projection.groupwiseMaxima.some(
      (maximum) => rowsNotOfTheGreatest(maximum, rowsOf(maximum.projection), rowsOf(maximum.groups)) > 0,
    )
  );
}

interface LoggedAt extends LoggedType {
  readonly streamPosition: number;
}

export interface StreamChecking<Fact extends LoggedAt> {
  readonly tables: readonly Table[];
  readonly streamProjections: readonly StreamProjection[];
  readonly logOf: () => readonly Fact[];
  readonly restaged: (tables: readonly Table[], fact: Fact) => void;
}

export interface StreamChecks {
  readonly verified: (table: string, address: ProjectedAddress) => void;
  readonly reset: (projection: string, address: ProjectedAddress) => void;
}

function rebuiltIn<Fact extends LoggedAt>(
  { tables, streamProjections, restaged }: StreamChecking<Fact>,
  log: readonly Fact[],
  { name, address }: { readonly name: string; readonly address: ProjectedAddress },
): void {
  const named = new Set(streamProjections.find((each) => each.name === name)?.tables.map((table) => table.name));
  const rebuilding = tables.filter(({ projection }) => named.has(projection.name));
  const prefix = streamPrefixOfAddress(address);
  for (const { rows } of rebuilding) {
    for (const [stored, kept] of rows) {
      if (streamPrefixOfAddress(kept) === prefix) {
        rows.delete(stored);
      }
    }
  }
  for (const fact of log.filter((each) => each.stream.startsWith(prefix))) {
    restaged(rebuilding, fact);
  }
}

function verifiedIn<Fact extends LoggedAt>(
  checking: StreamChecking<Fact>,
  { table, address }: { readonly table: string; readonly address: ProjectedAddress },
): void {
  const { tables, streamProjections, logOf } = checking;
  const projection = streamProjections.find(({ tables: its }) => its.some(({ name }) => name === table));
  if (projection === undefined || address.playbook === undefined) {
    return;
  }
  const log = logOf();
  const prefix = streamPrefixOfAddress(address);
  const rowsOf: RowsOf = (name) =>
    tables
      .filter((kept) => kept.projection.name === name)
      .flatMap((kept) => rowsAt(kept, address))
      .map(({ row }) => row);
  if (!checksFail(projection, log, prefix, rowsOf)) {
    return;
  }
  rebuiltIn(checking, log, { name: projection.name, address });
  if (checksFail(projection, log, prefix, rowsOf)) {
    throw new Error(
      `The rows of the read model ${projection.name} of ${prefix.slice(0, -1)} disagree with its facts after it was built again`,
    );
  }
}

export function streamChecksOf<Fact extends LoggedAt>(checking: StreamChecking<Fact>): StreamChecks {
  return {
    verified: (table, address) => {
      verifiedIn(checking, { table, address });
    },
    reset: (name, address) => {
      rebuiltIn(checking, checking.logOf(), { name, address });
    },
  };
}

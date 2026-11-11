import type { ContentHolders, JsonPointer } from '../held-content/content-declaration.ts';
import {
  keepsChildRows,
  projectedTableOf,
  type KeptProjection,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedRows,
} from '../projections/keyed-projection.ts';
import type { RunOutcome, RunOutcomeMapping } from '../run-outcomes/run-outcomes.ts';
import type { StreamProjection } from '../stream-projections/stream-projection.ts';
import { inlineMembersOf, sampledInline, twinsOf, type SampledFact } from './payload-twins.ts';

export type { SampledFact } from './payload-twins.ts';

export interface KeptTables {
  readonly projections: readonly KeptProjection[];
  readonly runOutcomes?: RunOutcomeMapping;
  readonly streamProjections?: readonly StreamProjection[];
}

export type PayloadReadBecause = 'folded' | 'unsampled';

export interface PayloadRead {
  readonly table: string;
  readonly type: string;
  readonly payload: JsonPointer;
  readonly because: PayloadReadBecause;
}

interface TableFold {
  readonly table: string;
  readonly types: readonly string[];
  readonly folded: (messages: readonly ProjectedMessage[]) => string;
}

function messagesOf(facts: readonly SampledFact[]): readonly ProjectedMessage[] {
  return facts.map(({ type, data, context }, index) => ({
    id: `sampled-${index + 1}`,
    position: index + 1,
    type,
    data,
    context,
  }));
}

function rowFolded<Row>(
  messages: readonly ProjectedMessage[],
  after: (row: Row | undefined, message: ProjectedMessage) => Row | undefined,
): Row | undefined {
  let row: Row | undefined;
  for (const message of messages) {
    row = after(row, message);
  }
  return row;
}

function outcomeOf(fold: () => unknown): string {
  try {
    return JSON.stringify({ folded: fold() });
  } catch (failure) {
    return JSON.stringify({ threw: String(failure) });
  }
}

function rowsFoldedBy(projection: KeptProjection, messages: readonly ProjectedMessage[]): unknown {
  if (!keepsChildRows(projection)) {
    return rowFolded<ProjectedRow>(messages, (row, message) => projection.rowAfter(row, message));
  }
  const rows = rowFolded<ProjectedRows>(
    messages,
    (folded, message) => projection.rowsAfter(folded ?? new Map(), message) ?? folded,
  );
  return rows === undefined ? undefined : [...rows];
}

function keyedFold(projection: KeptProjection): TableFold {
  const stream = { kind: String(projection.kinds.at(0)), id: 'sampled' };
  const keyOf = (message: ProjectedMessage) =>
    projection.keyOf === undefined ? stream.id : projection.keyOf(message, stream);
  return {
    table: projectedTableOf(projection),
    types: projection.types,
    folded: (messages) =>
      outcomeOf(() => ({
        keys: messages.map((message) => keyOf(message)),
        row: rowsFoldedBy(projection, messages),
      })),
  };
}

function outcomesFold(mapping: RunOutcomeMapping): TableFold {
  return {
    table: 'run_outcomes',
    types: mapping.types,
    folded: (messages) =>
      outcomeOf(() => rowFolded<RunOutcome>(messages, (row, message) => mapping.rowAfter(row, message))),
  };
}

function foldsOf({ projections, runOutcomes, streamProjections = [] }: KeptTables): readonly TableFold[] {
  return [
    ...projections.map((projection) => keyedFold(projection)),
    ...streamProjections.flatMap(({ tables }) => tables.map((projection) => keyedFold(projection))),
    ...(runOutcomes === undefined ? [] : [outcomesFold(runOutcomes)]),
  ];
}

function beforesOf(folded: readonly SampledFact[]): readonly (readonly SampledFact[])[] {
  return [...folded.map((_, index) => folded.slice(0, index)), ...folded.map((fact) => [fact])];
}

function readsIn(fold: TableFold, holders: ContentHolders, facts: readonly SampledFact[]): readonly PayloadRead[] {
  const folded = facts.filter(({ type }) => fold.types.includes(type));
  const befores = beforesOf(folded);
  return folded.flatMap((fact) =>
    inlineMembersOf(holders, fact.type)
      .filter((member) =>
        twinsOf(fact, member).some(({ fact: twin }) =>
          befores.some(
            (before) => fold.folded(messagesOf([...before, fact])) !== fold.folded(messagesOf([...before, twin])),
          ),
        ),
      )
      .map(({ pointer }): PayloadRead => ({ table: fold.table, type: fact.type, payload: pointer, because: 'folded' })),
  );
}

function unsampledIn(fold: TableFold, holders: ContentHolders, facts: readonly SampledFact[]): readonly PayloadRead[] {
  return fold.types.flatMap((type) =>
    inlineMembersOf(holders, type)
      .filter((member) => !facts.some((fact) => fact.type === type && sampledInline(fact, member).length > 0))
      .map(({ pointer }): PayloadRead => ({ table: fold.table, type, payload: pointer, because: 'unsampled' })),
  );
}

function firstOfEach(reads: readonly PayloadRead[]): readonly PayloadRead[] {
  return [...new Map(reads.map((read) => [JSON.stringify(read), read])).values()];
}

export function payloadReadsOf(
  tables: KeptTables,
  holders: ContentHolders,
  facts: readonly SampledFact[],
): readonly PayloadRead[] {
  return foldsOf(tables).flatMap((fold) =>
    firstOfEach([...readsIn(fold, holders, facts), ...unsampledIn(fold, holders, facts)]),
  );
}

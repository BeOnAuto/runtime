import type { Context, KeyedProjection, ProjectedMessage, ProjectedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { charactersIn } from '../document/memory-bounds.ts';
import { MemoryFactSchema, type RecordedMemoryFact, type RecordedRemembered } from '../facts/memory-fact-schema.ts';
import { memoriesKind } from '../facts/memory-facts.ts';

export const memoriesName = 'memories';

const decodeFact = Schema.decodeUnknownOption(MemoryFactSchema);

function sourceOf({ runId, definitionName }: Context): ProjectedRow {
  return { source_run: runId ?? null, source_definition: definitionName ?? null };
}

function rememberedRow({ data, context }: RecordedRemembered): ProjectedRow {
  const { version, text, tags, about, expires_at: expiresAt } = data;
  return {
    version,
    text,
    characters: text === null ? 0 : charactersIn(text),
    tags: JSON.stringify(tags),
    about_from: about?.from ?? null,
    about_to: about?.to ?? null,
    expires_at: expiresAt ?? null,
    written_at: context.at,
    written_by: context.by,
    ...sourceOf(context),
    status: text === null ? 'erased' : 'kept',
  };
}

const erasedRow: ProjectedRow = {
  status: 'erased',
  text: null,
  characters: 0,
  tags: JSON.stringify([]),
  about_from: null,
  about_to: null,
};

function endedRow(row: ProjectedRow, version: number, ended: ProjectedRow): ProjectedRow {
  return row['version'] === version ? { ...row, ...ended } : row;
}

function rowAfterFact(row: ProjectedRow | undefined, fact: RecordedMemoryFact): ProjectedRow | undefined {
  if (fact.type === 'memory_remembered') {
    return rememberedRow(fact);
  }
  if (row === undefined) {
    return undefined;
  }
  if (fact.type === 'memory_moved') {
    return { ...row, status: 'moved' };
  }
  return fact.type === 'memory_erased'
    ? endedRow(row, fact.data.version, erasedRow)
    : endedRow(row, fact.data.version, { status: 'forgotten' });
}

export const memoryRows: KeyedProjection = {
  name: memoriesName,
  version: 1,
  scopes: ['playbook', 'org'],
  kinds: [memoriesKind],
  types: ['memory_remembered', 'memory_forgotten', 'memory_erased', 'memory_moved'],
  columns: [
    { name: 'version', kind: 'integer' },
    { name: 'text', kind: 'text' },
    { name: 'characters', kind: 'integer' },
    { name: 'tags', kind: 'text' },
    { name: 'about_from', kind: 'text' },
    { name: 'about_to', kind: 'text' },
    { name: 'expires_at', kind: 'text' },
    { name: 'written_at', kind: 'text' },
    { name: 'written_by', kind: 'text' },
    { name: 'source_run', kind: 'text' },
    { name: 'source_definition', kind: 'text' },
    { name: 'status', kind: 'text' },
  ],
  indexes: [
    { name: 'by_status', columns: ['status', 'written_at', 'row_key'] },
    { name: 'by_written_at', columns: ['written_at', 'row_key'] },
  ],
  rowAfter: (row, message: ProjectedMessage) =>
    Option.getOrUndefined(Option.flatMapNullishOr(decodeFact(message), (fact) => rowAfterFact(row, fact))),
};

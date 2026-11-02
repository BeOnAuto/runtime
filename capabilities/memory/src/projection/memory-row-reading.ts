import type { ProjectedKeyedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import type { About } from '../document/memory-bounds.ts';
import type { MemoryStatus } from '../facts/memory-decider.ts';
import type { MemoryScope } from '../facts/memory-facts.ts';

const rowFields = {
  version: Schema.Int,
  characters: Schema.Int,
  tags: Schema.fromJsonString(Schema.Array(Schema.String)),
  expires_at: Schema.NullOr(Schema.String),
  written_at: Schema.String,
  written_by: Schema.String,
  source_run: Schema.NullOr(Schema.String),
  source_definition: Schema.NullOr(Schema.String),
  status: Schema.Literals(['kept', 'forgotten', 'erased', 'moved']),
};

const decodeRow = Schema.decodeUnknownSync(Schema.Struct({ ...rowFields, text: Schema.NullOr(Schema.String) }));

const decodeKeptRow = Schema.decodeUnknownSync(Schema.Struct({ ...rowFields, text: Schema.String }));

const decodeAbout = Schema.decodeUnknownOption(Schema.Struct({ about_from: Schema.String, about_to: Schema.String }));

export interface MemoryRow<Text extends string | null = string | null> {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly playbook: string | undefined;
  readonly version: number;
  readonly text: Text;
  readonly characters: number;
  readonly tags: readonly string[];
  readonly about: About | undefined;
  readonly expiresAt: string | null;
  readonly writtenAt: string;
  readonly writtenBy: string;
  readonly sourceRun: string | null;
  readonly sourceDefinition: string | null;
  readonly status: MemoryStatus;
}

export type KeptMemory = MemoryRow<string>;

interface DecodedRow<Text> {
  readonly version: number;
  readonly text: Text;
  readonly characters: number;
  readonly tags: readonly string[];
  readonly expires_at: string | null;
  readonly written_at: string;
  readonly written_by: string;
  readonly source_run: string | null;
  readonly source_definition: string | null;
  readonly status: MemoryStatus;
}

function aboutOf(row: ProjectedKeyedRow['row']): About | undefined {
  return Option.getOrUndefined(Option.map(decodeAbout(row), ({ about_from: from, about_to: to }) => ({ from, to })));
}

function rowOf<Text extends string | null>(
  { key, playbook, row }: ProjectedKeyedRow,
  kept: DecodedRow<Text>,
): MemoryRow<Text> {
  return {
    id: key,
    scope: playbook === undefined ? 'organization' : 'playbook',
    playbook,
    version: kept.version,
    text: kept.text,
    characters: kept.characters,
    tags: kept.tags,
    about: aboutOf(row),
    expiresAt: kept.expires_at,
    writtenAt: kept.written_at,
    writtenBy: kept.written_by,
    sourceRun: kept.source_run,
    sourceDefinition: kept.source_definition,
    status: kept.status,
  };
}

export function memoryRowOf(keyed: ProjectedKeyedRow): MemoryRow {
  return rowOf(keyed, decodeRow(keyed.row));
}

export function keptMemoryOf(keyed: ProjectedKeyedRow): KeptMemory {
  return rowOf(keyed, decodeKeptRow(keyed.row));
}

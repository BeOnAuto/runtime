import {
  recordedDecoder,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedStream,
  type RecordedCaller,
} from '@on.auto/operations';
import { Option } from 'effect';

import {
  DefinitionEventSchema,
  type DefinitionContent,
  type RecordedDefinitionEvent,
} from '../registry/definition-events.ts';
import { shapeNameIn } from '../shapes/published-output.ts';

const decodeFact = recordedDecoder(DefinitionEventSchema);

export function definitionFactOf(message: ProjectedMessage): RecordedDefinitionEvent | undefined {
  return Option.getOrUndefined(decodeFact(message));
}

export function definitionKeyOf(message: ProjectedMessage, { id }: ProjectedStream): string | undefined {
  const fact = definitionFactOf(message);
  return fact === undefined ? undefined : `${id}/${fact.context.definitionName}`;
}

function jsonOf(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function contentColumns(content: DefinitionContent): ProjectedRow {
  return {
    description: content.description ?? null,
    input_schema: jsonOf(content.input_schema),
    output_schema: jsonOf(content.output_schema),
    warnings: jsonOf(content.warnings),
    shape: shapeNameIn(content.details) ?? null,
    triggers: jsonOf(content.triggers),
  };
}

function pausedBy(caller: RecordedCaller | null): ProjectedRow {
  return { paused_by_id: caller?.id ?? null, paused_by_name: caller?.name ?? null };
}

const notPaused: ProjectedRow = { paused_at: null, ...pausedBy(null), reason: null };

function createdRow(fact: Extract<RecordedDefinitionEvent, { type: 'definition_created' }>, position: number) {
  const { at, definitionType, definitionName, definitionVersion } = fact.context;
  const { content, created_by: createdBy } = fact.data;
  return {
    definition_type: definitionType,
    name: definitionName,
    version: definitionVersion,
    status: 'active',
    ...contentColumns(content),
    created_at: at,
    created_by_id: createdBy.id,
    created_by_name: createdBy.name,
    updated_at: at,
    ...notPaused,
    retired_at: null,
    saved_position: position,
  };
}

function rowAfterFact(
  row: ProjectedRow,
  fact: Exclude<RecordedDefinitionEvent, { type: 'definition_created' }>,
  position: number,
): ProjectedRow {
  const { at } = fact.context;
  if (fact.type === 'definition_updated') {
    const version = fact.context.definitionVersion;
    const saved = { ...contentColumns(fact.data.content), saved_position: position };
    return { ...row, version, ...saved, updated_at: at, retired_at: null };
  }
  if (fact.type === 'definition_paused') {
    const reason = fact.data.reason ?? row['reason'] ?? null;
    return { ...row, status: 'paused', paused_at: at, ...pausedBy(fact.data.paused_by), reason };
  }
  if (fact.type === 'definition_restored') {
    return {
      ...row,
      status: 'paused',
      paused_at: at,
      ...pausedBy(fact.data.restored_by),
      updated_at: at,
      retired_at: null,
    };
  }
  return fact.type === 'definition_resumed'
    ? { ...row, status: 'active', ...notPaused }
    : { ...row, status: 'retired', ...notPaused, updated_at: at, retired_at: at };
}

function definitionRowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = definitionFactOf(message);
  if (fact?.type === 'definition_created') {
    return createdRow(fact, message.position);
  }
  return fact === undefined || row === undefined ? undefined : rowAfterFact(row, fact, message.position);
}

export const definitionRows: KeyedProjection = {
  name: 'definitions',
  version: 1,
  kinds: ['definitions'],
  types: [
    'definition_created',
    'definition_updated',
    'definition_retired',
    'definition_paused',
    'definition_resumed',
    'definition_restored',
  ],
  columns: [
    { name: 'definition_type', kind: 'text' },
    { name: 'name', kind: 'text' },
    { name: 'version', kind: 'integer' },
    { name: 'status', kind: 'text' },
    { name: 'description', kind: 'text' },
    { name: 'input_schema', kind: 'text' },
    { name: 'output_schema', kind: 'text' },
    { name: 'warnings', kind: 'text' },
    { name: 'shape', kind: 'text' },
    { name: 'triggers', kind: 'text' },
    { name: 'created_at', kind: 'text' },
    { name: 'created_by_id', kind: 'text' },
    { name: 'created_by_name', kind: 'text' },
    { name: 'updated_at', kind: 'text' },
    { name: 'paused_at', kind: 'text' },
    { name: 'paused_by_id', kind: 'text' },
    { name: 'paused_by_name', kind: 'text' },
    { name: 'reason', kind: 'text' },
    { name: 'retired_at', kind: 'text' },
    { name: 'saved_position', kind: 'integer' },
  ],
  indexes: [{ name: 'by_type', columns: ['definition_type', 'row_key'] }],
  keyOf: definitionKeyOf,
  rowAfter: definitionRowAfter,
};

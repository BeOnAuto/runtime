import type { KeyedProjection, ProjectedMessage, ProjectedRow, ProjectedStream } from '@on.auto/operations';

import { isDefinitionSaved } from '../registry/definition-events.ts';
import { definitionFactOf } from './definition-rows.ts';

function versionKeyOf(message: ProjectedMessage, { id }: ProjectedStream): string | undefined {
  const fact = definitionFactOf(message);
  if (fact === undefined || !(isDefinitionSaved(fact) || fact.type === 'definition_restored')) {
    return undefined;
  }
  const { definitionName, definitionVersion } = fact.context;
  return `${id}/${definitionName}/${definitionVersion}`;
}

function versionRowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = definitionFactOf(message);
  if (fact !== undefined && isDefinitionSaved(fact)) {
    const { definitionType, definitionName, definitionVersion, by } = fact.context;
    return {
      definition_type: definitionType,
      name: definitionName,
      version: definitionVersion,
      position: message.position,
      put_in_place_by: by,
    };
  }
  return row === undefined || fact === undefined ? undefined : { ...row, put_in_place_by: fact.context.by };
}

export const definitionVersionRows: KeyedProjection = {
  name: 'definition_versions',
  version: 2,
  kinds: ['definitions'],
  types: ['definition_created', 'definition_updated', 'definition_restored'],
  columns: [
    { name: 'definition_type', kind: 'text' },
    { name: 'name', kind: 'text' },
    { name: 'version', kind: 'integer' },
    { name: 'position', kind: 'integer' },
    { name: 'put_in_place_by', kind: 'text' },
  ],
  indexes: [],
  keyOf: versionKeyOf,
  rowAfter: versionRowAfter,
};

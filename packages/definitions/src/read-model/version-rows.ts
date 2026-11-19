import type { AddressedStream, KeyedProjection, ProjectedMessage, ProjectedRow } from '@on.auto/operations';

import { isDefinitionSaved } from '../registry/definition-events.ts';
import { definitionFactOf, definitionKeyOf } from './definition-rows.ts';

export function keyOfTheVersion(definitionKey: string, version: number): string {
  return `${definitionKey}/${version}`;
}

export function versionKeyOf(message: ProjectedMessage, stream: AddressedStream): string | undefined {
  const fact = definitionFactOf(message);
  const definitionKey = definitionKeyOf(message, stream);
  return fact === undefined ||
    definitionKey === undefined ||
    !(isDefinitionSaved(fact) || fact.type === 'definition_restored')
    ? undefined
    : keyOfTheVersion(definitionKey, fact.context.definitionVersion);
}

function versionRowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = definitionFactOf(message);
  if (fact !== undefined && isDefinitionSaved(fact)) {
    const { definitionType, definitionVersion, by } = fact.context;
    return {
      definition_type: definitionType,
      version: definitionVersion,
      position: message.position,
      put_in_place_by: by,
    };
  }
  return row === undefined || fact === undefined ? undefined : { ...row, put_in_place_by: fact.context.by };
}

export const definitionVersionRows: KeyedProjection = {
  name: 'definition_versions',
  version: 5,
  scopes: ['definition'],
  kinds: ['definitions'],
  types: ['definition_created', 'definition_updated', 'definition_restored'],
  columns: [
    { name: 'definition_type', kind: 'text' },
    { name: 'version', kind: 'integer' },
    { name: 'position', kind: 'integer' },
    { name: 'put_in_place_by', kind: 'text' },
  ],
  indexes: [],
  keyOf: versionKeyOf,
  rowAfter: versionRowAfter,
};

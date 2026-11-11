import type { StreamProjection } from '@on.auto/operations';

import { definitionTypeOrder } from '../capability/function-terminology.ts';
import { definitionRows } from './definition-rows.ts';
import { definitionReferenceRows } from './reference-rows.ts';
import { definitionVersionRows } from './version-rows.ts';

export function definitionsReadModelOf(types: readonly string[]): StreamProjection {
  return {
    name: 'definitions',
    version: 1,
    kind: 'definitions',
    streams: types,
    tables: [definitionRows, definitionVersionRows, definitionReferenceRows],
    counted: [
      { projection: 'definitions', facts: ['definition_created'] },
      { projection: 'definition_versions', facts: ['definition_created', 'definition_updated'] },
    ],
    groupwiseMaxima: [
      {
        projection: 'definitions',
        groups: 'definition_versions',
        groupedBy: ['definition_type', 'name'],
        greatest: 'version',
        matching: [
          { column: 'version', equals: 'version' },
          { column: 'saved_position', equals: 'position' },
        ],
      },
    ],
  };
}

export const definitionsReadModel: StreamProjection = definitionsReadModelOf(definitionTypeOrder);

import type { KeptProjection, ProjectedMessage, ProjectedStream } from '@on.auto/operations';

import { definitionTypeOrder } from '../capability/function-terminology.ts';
import { definitionKeyOf, definitionRows } from './definition-rows.ts';
import { definitionReferenceRows } from './reference-rows.ts';
import { definitionVersionRows, versionKeyOf } from './version-rows.ts';

type KeyOf = (message: ProjectedMessage, stream: ProjectedStream) => string | undefined;

function ofTheTypes(types: readonly string[], keyOf: KeyOf): KeyOf {
  return (message, stream) => (types.includes(stream.id) ? keyOf(message, stream) : undefined);
}

export function definitionsReadModelOf(types: readonly string[]): readonly KeptProjection[] {
  return [
    { ...definitionRows, keyOf: ofTheTypes(types, definitionKeyOf) },
    { ...definitionVersionRows, keyOf: ofTheTypes(types, versionKeyOf) },
    { ...definitionReferenceRows, keyOf: ofTheTypes(types, definitionKeyOf) },
  ];
}

export const definitionsReadModel: readonly KeptProjection[] = definitionsReadModelOf(definitionTypeOrder);

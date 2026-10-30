import { NotFound } from '@on.auto/operations';
import { Effect } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { DefinitionRegistry } from './definition-registry.ts';
import type { StoredDefinition } from './definition.ts';

export function definitionNotFound(type: string, name: string): NotFound {
  return new NotFound({ detail: `There is no ${definitionResourceLabel(type)} ${name} in this playbook` });
}

export function findDefinition(
  registry: DefinitionRegistry,
  type: string,
  name: string,
): Effect.Effect<StoredDefinition, NotFound> {
  const definition = registry.get(name);
  return definition === undefined ? Effect.fail(definitionNotFound(type, name)) : Effect.succeed(definition);
}

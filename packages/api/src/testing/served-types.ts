import { functionTypeOrder } from '@on.auto/definitions';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';

import type { DefinitionType, Guide, Recipe } from '../guides/guide-shelf.ts';
import { recipesFor } from '../guides/recipes.ts';
import { apiShippedRoots } from '../shipped-files/api-roots.ts';

export const functionTypes: readonly string[] = functionTypeOrder;

export function everySetOf(types: readonly string[]): readonly (readonly string[])[] {
  return types.reduce<readonly (readonly string[])[]>(
    (sets, type) => sets.concat(sets.map((set) => [...set, type])),
    [[]],
  );
}

export function definitionTypesOf(types: readonly string[], workflows: boolean): readonly DefinitionType[] {
  return [
    ...types.map((type) => ({ type, noun: `${type} function`, guide: `${type}-function` })),
    ...(workflows ? [{ type: 'workflow', noun: 'workflow', guide: 'workflow' }] : []),
  ];
}

export function typesNamedIn(text: string): readonly string[] {
  return functionTypes.filter((type) => new RegExp(`\\b${type}\\b`, 'u').test(text));
}

const recipeFiles = shippedFilesOnDisk(apiShippedRoots());

function guidesNamed(names: readonly string[]): readonly Guide[] {
  return names.map((name) => ({ name, title: name, description: name, text: `# ${name}\n` }));
}

function typesCarried(guides: readonly string[]): readonly DefinitionType[] {
  return guides.flatMap((guide) => {
    const type = guide.replace(/-function$/u, '');
    return guide.endsWith('-function') || guide === 'workflow'
      ? [{ type, noun: type === 'workflow' ? type : `${type} function`, guide }]
      : [];
  });
}

export function recipesCarrying(guides: readonly string[]): Promise<readonly Recipe[]> {
  return recipesFor(recipeFiles, guidesNamed(guides), typesCarried(guides));
}

export interface Serving {
  readonly workflows?: boolean;
  readonly pages?: boolean;
}

export function recipesServing(
  types: readonly string[],
  { workflows = true, pages = false }: Serving = {},
): Promise<readonly Recipe[]> {
  const definitionTypes = definitionTypesOf(types, workflows);
  return recipesFor(
    recipeFiles,
    guidesNamed([...definitionTypes.map(({ guide }) => guide), ...(pages ? ['page'] : [])]),
    definitionTypes,
  );
}

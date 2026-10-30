import {
  mostGuideBytes,
  mostGuidesBeyondTheRecipes,
  mostRecipeBytes,
  mostRecipes,
  requireBytesWithin,
  requireWithin,
} from '../bounds/served-bounds.ts';
import type { DefinitionType } from '../mcp/instructions.ts';

export interface Guide {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly text: string;
}

export interface RecipeArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

export type RecipeWords = Readonly<Record<string, string | undefined>>;

export interface Recipe extends Guide {
  readonly arguments: readonly RecipeArgument[];
  readonly formatGuide: string;
  readonly calls: readonly string[];
  readonly request: (words: RecipeWords) => string;
}

export interface ShelvedRecipe extends Recipe {
  readonly format: Guide;
}

export interface GuideShelf {
  readonly definitionTypes: readonly DefinitionType[];
  readonly guides: readonly Guide[];
  readonly recipes: readonly ShelvedRecipe[];
  readonly everyGuide: readonly Guide[];
  readonly named: (name: string) => Guide | undefined;
}

function requireDistinctNames(names: readonly string[]): void {
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) {
    throw new Error(`The guide name ${repeated} is used more than once`);
  }
}

function guideNamed(guides: readonly Guide[], whose: string, name: string): Guide {
  const guide = guides.find((carried) => carried.name === name);
  if (guide === undefined) {
    throw new Error(`${whose} names the guide ${name}, which the server does not carry`);
  }
  return guide;
}

export function guideShelfOf(
  guides: readonly Guide[],
  recipes: readonly Recipe[],
  definitionTypes: readonly DefinitionType[],
): GuideShelf {
  const everyGuide = [...guides, ...recipes];
  const names = everyGuide.map(({ name }) => name);
  requireDistinctNames(names);
  for (const { type, guide } of definitionTypes) {
    guideNamed(guides, `The definition type ${type}`, guide);
  }
  const shelved = recipes.map((recipe) => ({
    ...recipe,
    format: guideNamed(guides, `The recipe ${recipe.name}`, recipe.formatGuide),
  }));
  requireWithin(
    'The guides of the server',
    guides.length,
    mostGuidesBeyondTheRecipes(definitionTypes.length),
    'guides',
  );
  requireWithin('The recipes of the server', recipes.length, mostRecipes, 'recipes');
  for (const { name, text } of guides) {
    requireBytesWithin(`The guide ${name}`, text, mostGuideBytes);
  }
  for (const { name, text } of recipes) {
    requireBytesWithin(`The recipe ${name}`, text, mostRecipeBytes);
  }
  return {
    definitionTypes,
    guides,
    recipes: shelved,
    everyGuide,
    named: (name) => everyGuide.find((guide) => guide.name === name),
  };
}

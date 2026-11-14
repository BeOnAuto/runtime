import {
  mostGuideBytes,
  mostGuidesBeyondTheRecipes,
  mostRecipeBytesWhere,
  mostRecipes,
  requireBytesWithin,
  requireWithin,
} from '../bounds/served-bounds.ts';
export interface DefinitionType {
  readonly type: string;
  readonly noun: string;
  readonly guide: string;
}

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
  readonly formatGuide?: string;
  readonly calls: readonly string[];
  readonly request: (words: RecipeWords) => string;
}

export interface ShelvedRecipe extends Recipe {
  readonly format?: Guide;
}

export const pageGuideName = 'page';

export interface ShelfKept {
  readonly goals?: boolean;
  readonly messages?: boolean;
}

export const eventsGuideName = 'events';

export const goalsGuideName = 'goals';

export interface GuideShelf {
  readonly definitionTypes: readonly DefinitionType[];
  readonly pages: boolean;
  readonly messages: boolean;
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
  { goals = false, messages = false }: ShelfKept = {},
): GuideShelf {
  const everyGuide = [...guides, ...recipes];
  const names = everyGuide.map(({ name }) => name);
  requireDistinctNames(names);
  for (const { type, guide } of definitionTypes) {
    guideNamed(guides, `The definition type ${type}`, guide);
  }
  const shelved = recipes.map((recipe) =>
    recipe.formatGuide === undefined
      ? recipe
      : { ...recipe, format: guideNamed(guides, `The recipe ${recipe.name}`, recipe.formatGuide) },
  );
  requireWithin(
    'The guides of the server',
    guides.length,
    mostGuidesBeyondTheRecipes(definitionTypes.length, goals),
    'guides',
  );
  requireWithin('The recipes of the server', recipes.length, mostRecipes, 'recipes');
  for (const { name, text } of guides) {
    requireBytesWithin(`The guide ${name}`, text, mostGuideBytes);
  }
  for (const { name, text } of recipes) {
    requireBytesWithin(`The recipe ${name}`, text, mostRecipeBytesWhere(goals));
  }
  return {
    definitionTypes,
    pages: guides.some(({ name }) => name === pageGuideName),
    messages: goals && messages,
    guides,
    recipes: shelved,
    everyGuide,
    named: (name) => everyGuide.find((guide) => guide.name === name),
  };
}

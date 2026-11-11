import { shippedFileIn, type ShippedFiles } from '@on.auto/shipped-files';

import { everyDocumentCarriesItsPage, firstPlaybook, type Built } from './built-recipes.ts';
import { giveTools } from './give-tools-recipe.ts';
import { recipesFolder } from './guide-files.ts';
import { eventsGuideName, pageGuideName, type DefinitionType, type Guide, type Recipe } from './guide-shelf.ts';
import { outlines, type RecipeOutline } from './recipe-outlines.ts';
import type { Carried } from './start-guide.ts';

interface Insertion {
  readonly after: string;
  readonly words: string;
}

interface Additions {
  readonly insertions: readonly Insertion[];
  readonly calls: readonly string[];
}

type AdditionsByRecipe = Readonly<Record<string, Additions>>;

interface AdditionsOfGuides {
  readonly guides: readonly string[];
  readonly byRecipe: AdditionsByRecipe;
}

const whereWorkflowsAreServed: AdditionsByRecipe = {
  'first-playbook': {
    insertions: [],
    calls: ['publish_event', 'list_runs', 'get_run'],
  },
};

const theirPages = ` ${everyDocumentCarriesItsPage}`;

const wherePagesAreServed: AdditionsByRecipe = {
  schedule: {
    insertions: [
      {
        after: 'or write one in the format of the workflow guide.',
        words:
          ' Its document carries its `page`, so the person sees what each run did while they were away: keep it, or write it in the same document, as the workflow guide says under Its page.',
      },
      { after: 'and get_run for one run', words: ', whose headline says what it did' },
    ],
    calls: [],
  },
  keep: {
    insertions: [{ after: 'sets out `runs`.', words: theirPages }],
    calls: [],
  },
};

const whereWorkflowsHavePages: AdditionsByRecipe = {
  'first-playbook': { insertions: [], calls: ['update_playbook'] },
};

const additionsWhereServed: readonly AdditionsOfGuides[] = [
  { guides: ['workflow'], byRecipe: whereWorkflowsAreServed },
  { guides: ['page'], byRecipe: wherePagesAreServed },
  { guides: ['workflow', 'page'], byRecipe: whereWorkflowsHavePages },
];

function additionsTo(name: string, carried: ReadonlySet<string>): readonly Additions[] {
  return additionsWhereServed
    .filter(({ guides }) => guides.every((guide) => carried.has(guide)))
    .flatMap(({ byRecipe }) => byRecipe[name] ?? []);
}

function withInserted(text: string, insertions: readonly Insertion[]): string {
  return insertions.reduce(
    (inserted, { after, words }) => inserted.replace(after, (found) => `${found}${words}`),
    text,
  );
}

const builtRecipes: ReadonlyMap<string, Built> = new Map([
  ['first-playbook', firstPlaybook],
  ['give-tools', giveTools],
]);

interface Serving {
  readonly guides: ReadonlySet<string>;
  readonly carried: Carried;
}

async function textOf(
  shippedFiles: ShippedFiles,
  { name }: RecipeOutline,
  { carried }: Serving,
  additions: readonly Additions[],
): Promise<string> {
  const built = builtRecipes.get(name);
  if (built !== undefined) {
    return built.text(carried);
  }
  const text = await shippedFiles.text(shippedFileIn(recipesFolder, `${name}.md`));
  return withInserted(
    text,
    additions.flatMap(({ insertions }) => insertions),
  );
}

async function recipeOf(shippedFiles: ShippedFiles, outline: RecipeOutline, serving: Serving): Promise<Recipe> {
  const additions = additionsTo(outline.name, serving.guides);
  return {
    ...outline,
    text: await textOf(shippedFiles, outline, serving, additions),
    calls: [...outline.calls, ...additions.flatMap(({ calls }) => calls)],
  };
}

function offeredWith(guides: ReadonlySet<string>, served: Carried): readonly RecipeOutline[] {
  return outlines.filter(
    ({ name, formatGuide }) =>
      (formatGuide === undefined || guides.has(formatGuide)) && (builtRecipes.get(name)?.servedWhere(served) ?? true),
  );
}

export function recipesFor(
  shippedFiles: ShippedFiles,
  guides: readonly Guide[],
  definitionTypes: readonly DefinitionType[],
): Promise<readonly Recipe[]> {
  const carried = new Set(guides.map(({ name }) => name));
  const served: Carried = {
    definitionTypes,
    pages: carried.has(pageGuideName),
    events: carried.has(eventsGuideName),
    recipes: [],
  };
  const offered = offeredWith(carried, served);
  const serving: Serving = { guides: carried, carried: { ...served, recipes: offered.map(({ name }) => name) } };
  return Promise.all(offered.map((outline) => recipeOf(shippedFiles, outline, serving)));
}

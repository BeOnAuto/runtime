import { shippedFileIn, type ShippedFiles } from '@on.auto/shipped-files';

import { builtRecipes, everyDocumentCarriesItsPage } from './built-recipes.ts';
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

const whereInteractionIsServed: AdditionsByRecipe = {
  'give-tools': {
    insertions: [
      {
        after: 'and which of them it needs.',
        words: [
          " To act on a system, write an interaction function that calls the connection's tool with `call` instead: it answers at once and spends no model call, and its guide says how to write it from the answer execute_connection gave. Keep a reasoning function's `tools` for judgement over what the tools answer.",
          " To ask a person and take their answer, write an interaction function too: ask once where they want to be asked, then name in `deliver` the connection's tool that sends the request and in `replies` the one that reads the replies, or write `deliver: agent`; the interaction-function guide says how.",
        ].join(''),
      },
    ],
    calls: [],
  },
};

const whereWorkflowsAreServed: AdditionsByRecipe = {
  'give-tools': {
    insertions: [
      {
        after: 'and that the function can call only the tools it names.',
        words:
          '\n8. Then, with the workflow guide, write or change the workflow that owns the job the person wants done again, whose steps are the functions; save it once they agree, run it, and tell the person what it answered and what they can do next.',
      },
    ],
    calls: [],
  },
  'first-playbook': {
    insertions: [],
    calls: ['publish_event', 'list_runs', 'get_run'],
  },
};

const theirPages = ` ${everyDocumentCarriesItsPage}`;

const wherePagesAreServed: AdditionsByRecipe = {
  'give-tools': {
    insertions: [
      { after: 'before you write one.', words: theirPages },
      { after: 'in the format of the reasoning-function guide', words: ', with its `page` in the same document' },
      { after: 'whose steps are the functions', words: ', with its `page` in the same document' },
    ],
    calls: [],
  },
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

const whereLookupIsServed: AdditionsByRecipe = {
  'give-tools': {
    insertions: [
      {
        after: 'and which of them it needs.',
        words: ' To read what a tool marked reads returns, write a lookup function instead.',
      },
    ],
    calls: [],
  },
};

const additionsWhereServed: readonly AdditionsOfGuides[] = [
  { guides: ['interaction-function'], byRecipe: whereInteractionIsServed },
  { guides: ['lookup-function'], byRecipe: whereLookupIsServed },
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

interface Serving {
  readonly guides: ReadonlySet<string>;
  readonly carried: Carried;
}

async function textOf(
  shippedFiles: ShippedFiles,
  { name }: RecipeOutline,
  { carried }: Serving,
  additions: readonly Additions[],
): Promise<string | undefined> {
  const built = builtRecipes.get(name);
  if (built !== undefined) {
    return built(carried);
  }
  const text = await shippedFiles.text(shippedFileIn(recipesFolder, `${name}.md`));
  return withInserted(
    text,
    additions.flatMap(({ insertions }) => insertions),
  );
}

async function recipeOf(
  shippedFiles: ShippedFiles,
  outline: RecipeOutline,
  serving: Serving,
): Promise<Recipe | undefined> {
  const additions = additionsTo(outline.name, serving.guides);
  const text = await textOf(shippedFiles, outline, serving, additions);
  return text === undefined
    ? undefined
    : { ...outline, text, calls: [...outline.calls, ...additions.flatMap(({ calls }) => calls)] };
}

export async function recipesFor(
  shippedFiles: ShippedFiles,
  guides: readonly Guide[],
  definitionTypes: readonly DefinitionType[],
): Promise<readonly Recipe[]> {
  const carried = new Set(guides.map(({ name }) => name));
  const offered = outlines.filter(({ formatGuide }) => formatGuide === undefined || carried.has(formatGuide));
  const serving: Serving = {
    guides: carried,
    carried: {
      definitionTypes,
      pages: carried.has(pageGuideName),
      events: carried.has(eventsGuideName),
      recipes: offered.map(({ name }) => name),
    },
  };
  const recipes = await Promise.all(offered.map((outline) => recipeOf(shippedFiles, outline, serving)));
  return recipes.filter((recipe) => recipe !== undefined);
}

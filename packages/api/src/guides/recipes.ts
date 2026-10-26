import { shippedFileIn, type ShippedFiles } from '@on.auto/operations';

import { recipesFolder } from './guide-files.ts';
import type { Guide, Recipe } from './guide-shelf.ts';

type RecipeOutline = Omit<Recipe, 'text'>;

const outlines: readonly RecipeOutline[] = [
  {
    name: 'first-playbook',
    title: 'Create your first playbook',
    description: 'Creates a playbook with a first reasoning function, and runs it once the person has agreed to it.',
    arguments: [],
    formatGuide: 'reasoning-function',
    calls: ['list_playbooks', 'create_playbook', 'create_definition', 'execute', 'run_definition'],
    request: () => 'Create my first playbook.',
  },
  {
    name: 'remember',
    title: 'Make the playbook remember something',
    description:
      "Keeps what the playbook's runs answered or its events recorded in a recall function, so that the playbook can tell it later.",
    arguments: [
      {
        name: 'what',
        description: "What the playbook should remember, in the person's words, such as what it posted today",
        required: true,
      },
    ],
    formatGuide: 'recall-function',
    calls: ['list_definitions', 'create_definition', 'update_definition', 'publish_event', 'run_definition'],
    request: ({ what }) => `Make the playbook remember ${String(what)}.`,
  },
  {
    name: 'give-tools',
    title: 'Give the playbook tools',
    description: 'Gives a reasoning function the tools of a tool server the playbook may use.',
    arguments: [
      {
        name: 'server',
        description: 'The tool server whose tools to give, as search names it',
        required: false,
      },
    ],
    formatGuide: 'reasoning-function',
    calls: ['search', 'introspect', 'execute', 'create_definition', 'run_definition', 'list_playbook_events'],
    request: ({ server }) =>
      server === undefined ? 'Give the playbook tools.' : `Give the playbook the tools of the tool server ${server}.`,
  },
  {
    name: 'schedule',
    title: 'Run a workflow on a schedule',
    description: 'Starts a workflow on a schedule or on an event, and reads how its runs went.',
    arguments: [
      { name: 'workflow', description: 'The name of the workflow to run', required: true },
      {
        name: 'when',
        description: "When to run it, in the person's words, such as every weekday at 9:00",
        required: true,
      },
    ],
    formatGuide: 'workflow',
    calls: ['list_definitions', 'create_definition', 'update_definition', 'list_runs', 'get_run'],
    request: ({ workflow, when }) => `Run the workflow ${String(workflow)} ${String(when)}.`,
  },
];

interface Insertion {
  readonly after: string;
  readonly words: string;
}

interface Additions {
  readonly insertions: readonly Insertion[];
  readonly calls: readonly string[];
}

type AdditionsByRecipe = Readonly<Record<string, Additions>>;

interface AdditionsOfAGuide {
  readonly guide: string;
  readonly byRecipe: AdditionsByRecipe;
}

const whereInteractionIsServed: AdditionsByRecipe = {
  'give-tools': {
    insertions: [
      {
        after: 'and which of them it needs.',
        words: [
          ' When the playbook only needs what a tool answers, with nothing to reason about, write an interaction function that calls the tool instead: it answers at once with what the tool answered and spends no model call, and the interaction-function guide says how to write it from the answer execute gave.',
          ' When the playbook should send a person a message through a tool and take their answer, write an interaction function instead: the interaction-function guide says how it names the tool it sends through and the tool it reads replies with, each called the same way.',
        ].join(''),
      },
    ],
    calls: [],
  },
  'first-playbook': {
    insertions: [
      {
        after: 'give it tools with the give-tools recipe',
        words: ', send someone a message through a tool and take their answer with an interaction function',
      },
    ],
    calls: [],
  },
};

const whereWorkflowsAreServed: AdditionsByRecipe = {
  'first-playbook': {
    insertions: [
      {
        after: 'the person sees answer',
        words: ', and, where the work should run on its own, the workflow that runs it',
      },
      {
        after: 'a budget and a measurable goal.',
        words:
          ' Then learn how its work starts: on its own at set times, on its own whenever something arrives, or only when someone asks. Where their words already say so, such as "every morning", "continuously", "keep reviewing" or "whenever a lead comes in", take that as the answer and say so rather than asking again.',
      },
      {
        after: 'tell the person what it answered, in their words.',
        words: [
          "\n7. Where the work starts on its own, read the workflow guide with get_guide and write the workflow that runs the function, with a `schedule` as the guide says. For set times, `cron` in UTC or `every`: a run they start is given only its due time, so the function finds its material with its tools, or the workflow gives it a fixed input in `input.from`. For what arrives, `on` with a filter on an event `type` named in the past tense, such as `com.acme.lead.received`: a run is given a list holding the event, and the workflow passes the event's `data` to the function. Where the material comes from sources not yet connected, start with `on`, so that the person starts runs today with material they paste, and move to a clock once the function's tools reach the sources.",
          "\n8. Show the person the workflow's document, and save it with create_definition, `type` workflow, once they agree.",
          '\n9. Tell the person when it next runs, in their own time, or what starts it. For `on`, publish the material they paste with publish_event, as an event of that type with a `source` that names where it came from, and a moment later show what its run answered with list_runs, `type` workflow, and get_run.',
        ].join(''),
      },
      {
        after: 'what they can do next:',
        words: ' change when it runs with the schedule recipe and the workflow guide,',
      },
    ],
    calls: ['publish_event', 'list_runs', 'get_run'],
  },
};

const additionsWhereServed: readonly AdditionsOfAGuide[] = [
  { guide: 'interaction-function', byRecipe: whereInteractionIsServed },
  { guide: 'workflow', byRecipe: whereWorkflowsAreServed },
];

function additionsTo(name: string, carried: ReadonlySet<string>): readonly Additions[] {
  return additionsWhereServed.filter(({ guide }) => carried.has(guide)).flatMap(({ byRecipe }) => byRecipe[name] ?? []);
}

function withInserted(text: string, insertions: readonly Insertion[]): string {
  return insertions.reduce(
    (inserted, { after, words }) => inserted.replace(after, (found) => `${found}${words}`),
    text,
  );
}

async function recipeOf(
  shippedFiles: ShippedFiles,
  outline: RecipeOutline,
  carried: ReadonlySet<string>,
): Promise<Recipe> {
  const text = await shippedFiles.text(shippedFileIn(recipesFolder, `${outline.name}.md`));
  const additions = additionsTo(outline.name, carried);
  return {
    ...outline,
    text: withInserted(
      text,
      additions.flatMap(({ insertions }) => insertions),
    ),
    calls: [...outline.calls, ...additions.flatMap(({ calls }) => calls)],
  };
}

export function recipesFor(shippedFiles: ShippedFiles, guides: readonly Guide[]): Promise<readonly Recipe[]> {
  const carried = new Set(guides.map(({ name }) => name));
  return Promise.all(
    outlines
      .filter(({ formatGuide }) => carried.has(formatGuide))
      .map((outline) => recipeOf(shippedFiles, outline, carried)),
  );
}

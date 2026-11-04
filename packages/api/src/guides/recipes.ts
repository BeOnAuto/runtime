import { shippedFileIn, type ShippedFiles } from '@on.auto/shipped-files';

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
    calls: ['list_playbooks', 'create_playbook', 'create_definition', 'query_connection', 'run_definition'],
    request: () => 'Create my first playbook.',
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
    calls: [
      'search',
      'introspect',
      'query_connection',
      'execute_connection',
      'create_definition',
      'run_definition',
      'list_playbook_events',
    ],
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
    calls: [
      'list_definitions',
      'create_definition',
      'update_definition',
      'list_runs',
      'get_run',
      'list_playbook_events',
    ],
    request: ({ workflow, when }) => `Run the workflow ${String(workflow)} ${String(when)}.`,
  },
  {
    name: 'keep',
    title: 'Keep something for later',
    description:
      "Keeps what the person wants kept as the output of a run, and reads it back with a lookup of that definition's runs.",
    arguments: [
      {
        name: 'what',
        description: "What to keep, in the person's words, such as who approves a budget",
        required: true,
      },
    ],
    formatGuide: 'lookup-function',
    calls: ['list_definitions', 'create_definition', 'run_definition'],
    request: ({ what }) => `Keep ${String(what)} for later.`,
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
  'first-playbook': {
    insertions: [
      {
        after: 'is not a model to run.',
        words:
          ' Where a person must approve or decide, ask once where they want to be asked: through a connection that can send them a request and read their reply, such as a chat, an email provider or a ticketing app, or through you, `deliver: agent`; a request saved with neither lists those that can. Ask once, too, where a notice goes: a channel or their direct messages.',
      },
      {
        after: 'give it tools with the give-tools recipe.',
        words: ' They can also ask someone through a connection and take their answer with an interaction function.',
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
          '\n9. Then, with the workflow guide, write or change the workflow whose steps are the functions, which does what the person asked; save it once they agree, run it, and tell the person what it answered and what they can do next.',
      },
    ],
    calls: [],
  },
  'first-playbook': {
    insertions: [
      {
        after: 'the person sees answer',
        words: ', and the workflow whose step it is, which does what the person asked',
      },
      {
        after: 'run the function with run_definition',
        words: ' to test it',
      },
      {
        after: 'a budget and a measurable goal.',
        words:
          ' Then learn how its work starts: on its own at set times, on its own whenever something arrives, or only when someone asks. Where their words already say so, such as "every morning", "continuously" or "whenever a lead comes in", take that as the answer and say so rather than asking again.',
      },
      {
        after: 'tell the person what it answered, in their words.',
        words: [
          "\n7. Read the workflow guide with get_guide and write the workflow whose step is the function, which does what the person asked: a one-step workflow is still a workflow, and a later ask changes it. Where the work starts on its own, give it a `schedule` as the guide says. For set times, `cron` with `time_zone` naming the person's time zone, or `every`: a run they start is given only its due time, so the function finds its material with its tools, or the workflow gives it a fixed input in `input.from`. For what arrives, `on` with a filter on an event `type` named in the past tense, such as `com.acme.lead.received`: a run is given a list holding the event, and the workflow passes the event's `data` to the function. Where the material comes from sources not yet connected, start with `on`, so that the person starts runs today with material they paste, and move to a clock once the function's tools reach the sources.",
          "\n8. Show the person the workflow's document, and save it with create_definition, `type` workflow, once they agree.",
          "\n9. Run the workflow with run_definition and tell the person what it answered, in their words. Where it starts on its own, tell them too when it next runs, in their own time, or what starts it. For `on`, publish the material they paste with publish_event, as an event of that type with a `source` that names where it came from and an `id` of its own, such as `test-1`: a real event's `source` and `id` would make that event a repeat, ignored when it comes. A moment later, show what its run answered with list_runs, `type` workflow, and get_run.",
        ].join(''),
      },
      {
        after: 'what they can do next:',
        words: ' change when it runs with the schedule recipe and the workflow guide, or',
      },
    ],
    calls: ['publish_event', 'list_runs', 'get_run'],
  },
};

const everyDocumentCarriesItsPage =
  ' Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Read the page guide with get_guide, and write each page in its document, as its format guide says under Its page.';

const wherePagesAreServed: AdditionsByRecipe = {
  'first-playbook': {
    insertions: [
      { after: 'before you write the function.', words: everyDocumentCarriesItsPage },
      {
        after: 'and a prompt.',
        words:
          ' Write its `page` in the same front matter: the judgement of each run in a sentence, and the outcomes over time.',
      },
      {
        after: 'and a later ask changes it.',
        words:
          ' Write its `page` in the same document: the outcome of each run as a headline with its key figures, and the main number of each period.',
      },
    ],
    calls: [],
  },
  'give-tools': {
    insertions: [
      { after: 'before you write one.', words: everyDocumentCarriesItsPage },
      { after: 'in the format of the reasoning-function guide', words: ', with its `page` in the same document' },
      { after: 'which does what the person asked', words: ', with its `page` in the same document' },
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
    insertions: [{ after: 'sets out `runs`.', words: everyDocumentCarriesItsPage }],
    calls: [],
  },
};

const whereWorkflowsHavePages: AdditionsByRecipe = {
  'first-playbook': {
    insertions: [
      {
        after: 'give it tools with the give-tools recipe.',
        words:
          " Once it has more than one workflow, give the playbook a page with update_playbook, led by each workflow's main number.",
      },
    ],
    calls: ['update_playbook'],
  },
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

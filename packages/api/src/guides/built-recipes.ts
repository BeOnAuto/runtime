import {
  follows,
  partLinesOf,
  readsAndJudgements,
  runningAtOnce,
  sentenceOver,
  serves,
  where,
  type Carried,
} from './start-guide.ts';

export interface Built {
  readonly servedWhere: (carried: Carried) => boolean;
  readonly text: (carried: Carried) => string;
}

export const everyDocumentCarriesItsPage =
  "Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Write it as its type's guide shows under Its page. Read the page guide for the playbook's own page, or a page that folds other events or sets charts side by side.";

export const modelsOfAServer =
  'A reasoning function needs a model the runtime can call. Hosted Auto supplies models. On a self-hosted runtime, the operator configures a model provider: https://on.auto/docs/self-host/configuration#models.';

export const goalsInsertedAfter = 'or use the playbook they name when list_playbooks shows it.';

const goalsAsked =
  'Here a playbook is made only with its goals, so before you create it, ask the person in the same round as step 1: What should this playbook achieve for you, and how will you know it worked?';

const toldAsked = 'Learn too what they want to be told when it passes, fails or becomes overdue, and where.';

const goalsSavedAndAgreed =
  'Propose the goals once, as the goals guide says, and after their yes send them as the goals argument of create_playbook; a playbook they name that has no goals yet takes them through update_playbook. Then give the person the `studio` link it answers, record their yes with agree_playbook_goals when the saved goals are the ones they agreed, and make nothing else before that call. Every workflow you save then says, in its `contributes`, what it does for a goal.';

export function sentences(...given: readonly (readonly string[])[]): string {
  return given.flat().join(' ');
}

export function inSteps(steps: readonly string[]): readonly string[] {
  return steps.map((step, index) => `${index + 1}. ${step}`);
}

function opening(carried: Carried): string {
  const workflows = serves(carried, 'workflow');
  return sentences(
    [
      workflows
        ? "A first playbook is built in the order of the start guide's Build from the job: what the person wants it to achieve, the workflow that achieves it, then its steps as functions."
        : "A first playbook starts from the job the person wants done again and again, in parts as the start guide's Build from the job says, each a function of the type its work needs.",
    ],
    [
      'Read the start guide with get_guide if you have not yet.',
      `Read a type's guide before you write a function of that type${workflows ? ', and the workflow guide before you write the workflow' : ''}.`,
    ],
    where(carried.pages, everyDocumentCarriesItsPage),
    ['Give the person the `studio` link that each create or run answers, to its page in Studio.'],
    where(serves(carried, 'reasoning'), modelsOfAServer),
  );
}

function choosingAModel(carried: Carried): readonly string[] {
  return where(
    serves(carried, 'reasoning'),
    'Call list_models where this connection has it to see the models this server can call. When it lists none and says in `provider_setup` how the person adds a model provider, help them do that first. When more than one model is offered, ask which to use; a model whose id ends in `*` stands for many and is not a model to run.',
  );
}

function askingForTheJob(carried: Carried): string {
  return sentences(
    [
      'Ask the person what the playbook is for, in their own words, and the first job it should do again and again: what it is given or must find, what it must work out, who must decide or be told, and the result they want from it.',
    ],
    where(
      serves(carried, 'workflow'),
      'Then learn how its work starts: on its own at set times, on its own whenever something arrives, or only when someone asks. Where their words already say so, such as "every morning" or "whenever one arrives", take that as the answer rather than asking again.',
    ),
    where(
      serves(carried, 'interaction'),
      "Where a person must approve or decide, ask once where they want to be asked, as the start guide's Asking a person says. Where the job itself sends a notice, ask once where it goes: a channel or their direct messages.",
    ),
  );
}

const howManyShapes = ['Two', 'Three', 'Four'];

function shapesOf(carried: Carried): readonly string[] {
  const reasoning = serves(carried, 'reasoning');
  const lookup = serves(carried, 'lookup');
  const computation = serves(carried, 'computation');
  const shapes = [
    ...where(reasoning, 'A job that only judges what the person gives is one reasoning function.'),
    ...where(computation, 'A job that only calculates is one computation function.'),
    ...where(
      lookup && computation && reasoning,
      'A job that reads, calculates and writes is a lookup function, a computation function and a reasoning function.',
    ),
    ...where(
      lookup && reasoning && serves(carried, 'interaction'),
      'A job that reads, judges, asks and then acts is a lookup function, a reasoning function and two interaction functions.',
    ),
  ];
  return shapes.length < 2 ? shapes : [`${String(howManyShapes[shapes.length - 2])} shapes show the range.`, ...shapes];
}

function designingTheWorkflow(carried: Carried): string {
  return sentences(
    choosingAModel(carried),
    [
      "Design the workflow that achieves what the playbook is for, as the start guide's Build from the job says, before you write any function.",
    ],
    shapesOf(carried),
    readsAndJudgements(carried),
    ['Then show the person the design and get their yes before you write anything.'],
  );
}

function partsAndTheirTypes(carried: Carried): string {
  return sentences(
    choosingAModel(carried),
    [
      'Say the job back to the person as its parts, in the order they happen, and give each part its function type by what the part does, from the list in Build from the job.',
    ],
    shapesOf(carried),
    ['Agree the parts and their types with the person before you write anything.'],
  );
}

function pieceOf(carried: Carried): string {
  return serves(carried, 'workflow') ? 'step' : 'part';
}

function aRunToday(carried: Carried): readonly string[] {
  return [
    'Or build without it for now, so that the person sees a run today.',
    ...where(
      serves(carried, 'workflow'),
      'Let the workflow take what a step would read as its input, pasted by the person.',
    ),
    ...where(serves(carried, 'interaction'), 'Ask a person through you (`deliver: agent`).'),
    `Leave a ${pieceOf(carried)} that has a service act, or sends a notice, until its service is connected, and tell the person it is not built yet.`,
  ];
}

function whatGiveToolsMakes(carried: Carried): readonly string[] {
  return [
    `For a ${pieceOf(carried)} that reads from a service or acts on one, follow the give-tools recipe.`,
    'Where that service is not connected yet, connect it with the connect-a-service recipe.',
  ];
}

function writingEachFunction(carried: Carried): string {
  return sentences(
    [
      `${serves(carried, 'workflow') ? "Write the function of each step of the design, in the format of its type's guide" : "Write each part's function in the format of its type's guide"}${carried.pages ? ', each with its `page` in the same document' : ''}.`,
    ],
    follows(carried, 'give-tools') ? whatGiveToolsMakes(carried) : [],
    follows(carried, 'give-tools') ? aRunToday(carried) : [],
    ['Show the person the documents and ask whether to save them.'],
  );
}

function savingEach(carried: Carried): string {
  return sentences(
    [
      `Once they agree, save each with create_definition, with its \`type\`, its \`diagram\` and, where it helps, its \`overview\`, as the arguments say${serves(carried, 'workflow') ? ': a workflow takes no `diagram`' : ''}.`,
    ],
    ['A name that is taken is refused. Choose another with the person rather than change the function that has it.'],
  );
}

function testingEach(carried: Carried): string {
  return sentences(
    [
      'Test each function that can run now with run_definition on a made-up input, and tell the person what it answered, in their words.',
    ],
    sentenceOver(runningAtOnce(carried), 'needs no connection', 'These need no connection'),
    where(
      serves(carried, 'interaction'),
      'A test of one held for you waits for its answer: list_interactions shows the request, and answer_interaction answers it once the person says what to answer.',
    ),
    ['A function that has a service act really acts when it runs, so run it only once the person agrees.'],
    where(serves(carried, 'prediction'), 'A prediction function answers once the playbook has history.'),
  );
}

function writingTheWorkflow(carried: Carried): string {
  const lookups = serves(carried, 'lookup');
  return sentences(
    [
      "Write the workflow's document from the design the person agreed, as the workflow guide says: its steps call the functions you saved and hand each one what the steps before it answered. One step is enough when that step finishes the job, and a later ask changes the workflow.",
    ],
    where(
      carried.pages,
      'Write its `page` in the same document: the outcome of each run as a headline with its key figures, and the main number of each period.',
    ),
    [
      "Where the work starts on its own, give it a `schedule`, as the triggers guide says: `cron` with the person's `time_zone`, or `every`, for set times, and `on` for what arrives.",
      `A run on a clock is given its due time alone, so ${lookups ? 'its first steps are the lookup functions that find its material, or ' : ''}the workflow gives it a fixed input in \`input.from\`.`,
      `Where the material comes from sources not yet connected, start with \`on\`, so that the person starts runs today with material they paste, and move to a clock once ${lookups ? 'lookup functions reach' : 'its functions reach'} the sources.`,
    ],
  );
}

const savingTheWorkflow =
  "Show the person the workflow's document, and save it with create_definition, `type` workflow, once they agree.";

function runningTheWorkflow(carried: Carried): string {
  return sentences(
    [
      'Run the workflow once, in one of two ways, never both.',
      "Where it starts `on` an event, publish the material they paste with publish_event, as an event of that type with a `source` that names where it came from and an `id` of its own, such as `test-1`. A real event's `source` and `id` would make that event a repeat, ignored when it comes.",
      'The event starts the run, so a moment later find it with list_runs, `type` workflow, and read it with get_run.',
      'Otherwise, start the run with run_definition.',
    ],
    where(
      serves(carried, 'interaction'),
      'A step held for you (`deliver: agent`) waits for its answer, which you give with answer_interaction, as in a test.',
    ),
    [
      'Tell the person what the run answered, in their words. Where the workflow starts on its own, tell them too when it next runs, in their own time, or what starts it.',
    ],
  );
}

function whatComesNext(carried: Carried): readonly string[] {
  const next = [
    ...where(follows(carried, 'schedule'), 'change when it runs with the schedule recipe and the triggers guide'),
    ...where(
      follows(carried, 'give-tools'),
      `connect the services its ${pieceOf(carried)}s still wait for, with the connect-a-service and give-tools recipes`,
    ),
  ];
  return where(
    next.length > 0,
    '',
    sentences(
      [`Then tell the person what they can do next: ${next.join(', or ')}.`],
      where(
        serves(carried, 'workflow') && carried.pages,
        "Once it has more than one workflow, give the playbook a page with update_playbook, led by each workflow's main number.",
      ),
    ),
  );
}

function creatingThePlaybook(carried: Carried): string {
  return sentences(
    [`Create the playbook with create_playbook, with the person's words on what it is for, ${goalsInsertedAfter}`],
    where(carried.goals === true, goalsAsked),
    where(carried.goals === true && carried.messages === true, toldAsked),
    where(carried.goals === true, goalsSavedAndAgreed),
  );
}

function firstPlaybookText(carried: Carried): string {
  const workflows = serves(carried, 'workflow');
  const steps = [
    askingForTheJob(carried),
    'Call list_playbooks.',
    creatingThePlaybook(carried),
    workflows ? designingTheWorkflow(carried) : partsAndTheirTypes(carried),
    writingEachFunction(carried),
    savingEach(carried),
    testingEach(carried),
    ...where(workflows, writingTheWorkflow(carried), savingTheWorkflow, runningTheWorkflow(carried)),
  ];
  return [
    '# Create your first playbook',
    '',
    opening(carried),
    '',
    ...inSteps(steps),
    ...whatComesNext(carried),
    '',
  ].join('\n');
}

export const firstPlaybook: Built = {
  servedWhere: (carried) => partLinesOf(carried).length > 0,
  text: firstPlaybookText,
};

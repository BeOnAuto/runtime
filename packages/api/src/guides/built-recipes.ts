import {
  follows,
  inTurn,
  partLinesOf,
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
  'Every function and workflow you write carries its `page`, which shows the person what each run achieved and what the runs add up to. Read the page guide with get_guide, and write each page in its document as the page guide says.';

export const modelsOfAServer =
  'A reasoning function needs a model the runtime can call. Hosted Auto supplies models. On a self-hosted runtime, the operator configures a model provider: https://on.auto/docs/self-host/configuration#models.';

export function sentences(...given: readonly (readonly string[])[]): string {
  return given.flat().join(' ');
}

export function inSteps(steps: readonly string[]): readonly string[] {
  return steps.map((step, index) => `${index + 1}. ${step}`);
}

function opening(carried: Carried): string {
  const workflows = serves(carried, 'workflow');
  return sentences(
    ['A first playbook starts from the job the person wants done again and again.'],
    [
      workflows
        ? 'Break the job into its parts, give each part a function of the type its work needs, and write the workflow that runs the parts in order.'
        : 'Break the job into its parts, and give each part a function of the type its work needs.',
    ],
    [
      `Read a type's guide with get_guide before you write a function of that type${workflows ? ', and the workflow guide before you write the workflow' : ''}.`,
    ],
    where(carried.pages, everyDocumentCarriesItsPage),
    [
      'When you create or run something, the response includes `studio`, a link to its page in Studio. Give that link to the person.',
    ],
    where(serves(carried, 'reasoning'), modelsOfAServer),
  );
}

function listingTheModels(carried: Carried): string {
  return serves(carried, 'reasoning')
    ? 'Call list_playbooks, and list_models where this connection has it to see the models this server can call. When it lists none and says in `provider_setup` how the person adds a model provider, help them do that first.'
    : 'Call list_playbooks.';
}

function askingForTheJob(carried: Carried): string {
  return sentences(
    [
      'Ask the person what the playbook is for, in their own words, and the first job it should do again and again: what it is given or must find, what it must work out, who must decide or be told, and the result they want from it.',
    ],
    where(
      serves(carried, 'workflow'),
      'Then learn how its work starts: on its own at set times, on its own whenever something arrives, or only when someone asks. Where their words already say so, such as "every morning", "continuously" or "whenever one arrives", take that as the answer and say so rather than asking again.',
    ),
    where(
      serves(carried, 'reasoning'),
      'When more than one model is offered, ask which to use; a model whose id ends in `*` stands for many and is not a model to run.',
    ),
    where(
      serves(carried, 'interaction'),
      'Where a person must approve or decide, ask once where they want to be asked. It can be through a connection that sends them a request and reads their reply, such as a chat, an email provider or a ticketing app, or through you (`deliver: agent`). A request saved with neither is refused, and the refusal names the connections that can send it and read the reply. Ask once, too, where a notice goes: a channel or their direct messages.',
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

function partsAndTheirTypes(carried: Carried): string {
  const paragraph = sentences(
    where(
      serves(carried, 'workflow'),
      'The order of the parts, the branches, the waits and what happens when a part fails belong to the workflow, never to a prompt.',
    ),
    shapesOf(carried),
    ['Agree the parts and their types with the person before you write anything.'],
  );
  return [
    'Say the job back to the person as its parts, in the order they happen, and give each part its type by what the part does, not by how it is done:',
    ...partLinesOf(carried).map((line) => `   ${line}`),
    '',
    `   ${paragraph}`,
  ].join('\n');
}

function aRunToday(carried: Carried): readonly string[] {
  return [
    'Or build without it for now, so that the person sees a run today.',
    ...where(
      serves(carried, 'workflow'),
      'Let the workflow take what a part would read as its input, pasted by the person.',
    ),
    ...where(serves(carried, 'interaction'), 'Ask a person through you (`deliver: agent`).'),
    'Leave a part that has a service act, or sends a notice, until its service is connected, and tell the person it is not built yet.',
  ];
}

function whatGiveToolsMakes(carried: Carried): readonly string[] {
  const made = [
    ...where(serves(carried, 'lookup'), 'a read a lookup function'),
    ...where(serves(carried, 'interaction'), 'an act an interaction function'),
  ];
  return [
    'For a part that reads from a service or acts on one, follow the give-tools recipe.',
    ...where(made.length > 0, `It makes ${inTurn(made, 'and')}.`),
    ...where(
      made.length > 0 && serves(carried, 'reasoning'),
      'A reasoning function names tools in `tools` only where its model must choose among them.',
    ),
    'Where that service is not connected yet, connect it with the connect-a-service recipe.',
  ];
}

function writingEachFunction(carried: Carried): string {
  return sentences(
    [
      `Write each function in the format of its type's guide, in the order the job uses them${carried.pages ? ', each with its `page` in the same document' : ''}.`,
    ],
    where(
      serves(carried, 'reasoning') && serves(carried, 'workflow'),
      'A reasoning function takes the facts it judges as its input, which the workflow hands it.',
    ),
    follows(carried, 'give-tools') ? whatGiveToolsMakes(carried) : [],
    follows(carried, 'give-tools') ? aRunToday(carried) : [],
    ['Show the person the documents and ask whether to save them.'],
  );
}

function savingEach(carried: Carried): string {
  return sentences(
    ['Once they agree, save each with create_definition, with its `type`.'],
    ['A function needs `diagram`: Mermaid source of how it works, or the word none.'],
    where(serves(carried, 'workflow'), 'A workflow takes none.'),
    ['`overview` is optional: Markdown that tells the person what it does and why it is needed.'],
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
      'A test of an interaction function held for you (`deliver: agent`) waits for its answer. list_interactions shows the request, and answer_interaction answers it once the person says what to answer.',
    ),
    ['A function that has a service act really acts when it runs. Run it only once the person agrees.'],
    where(serves(carried, 'prediction'), 'A prediction function answers once the playbook has history.'),
  );
}

function writingTheWorkflow(carried: Carried): string {
  const lookups = serves(carried, 'lookup');
  return sentences(
    [
      'Read the workflow guide with get_guide and write the workflow that owns the job, whose steps call the functions in order and hand each one what the steps before it answered: one step is enough when that step finishes the job, and a later ask changes the workflow.',
    ],
    where(
      carried.pages,
      'Write its `page` in the same document: the outcome of each run as a headline with its key figures, and the main number of each period.',
    ),
    [
      'Where the work starts on its own, give it a `schedule`, as the triggers guide says.',
      'A `schedule` holds its triggers: `cron` or `every` for set times, and `on` for what arrives.',
      "For set times, use `cron` with `time_zone` naming the person's time zone, or `every`. A run on a clock is given its due time alone.",
      `So ${lookups ? 'its first steps are the lookup functions that find its material, or ' : ''}the workflow gives it a fixed input in \`input.from\`.`,
      'For what arrives, use `on` with a filter on an event `type` named in the past tense, such as `com.example.item.received`.',
      "A run is then given a list holding the event, and the workflow passes the event's `data` to its first step.",
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
      'connect the services its parts still wait for, with the connect-a-service and give-tools recipes',
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

function firstPlaybookText(carried: Carried): string {
  const workflows = serves(carried, 'workflow');
  const steps = [
    listingTheModels(carried),
    askingForTheJob(carried),
    partsAndTheirTypes(carried),
    "Create the playbook with create_playbook, with the person's words on what it is for, or use the playbook they name when list_playbooks shows it.",
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

import { listed as listedInWords } from '@on.auto/phrasing';

import type { DefinitionType, Guide } from './guide-shelf.ts';

export const startGuideName = 'start';

export const whatTheStartGuideSays =
  'what a playbook is made of, what a workflow owns, what you do yourself, and which guide each task needs';

const whatTheStartGuideIsFor =
  'Where an agent begins: what a playbook is made of, what a workflow owns, what the agent does itself, and which guide each task needs.';

interface Carried {
  readonly definitionTypes: readonly DefinitionType[];
  readonly pages: boolean;
  readonly recipes: readonly string[];
}

type Lines = (carried: Carried) => readonly string[];

const purposeOfEachFunctionType: Readonly<Record<string, string>> = {
  reasoning: 'prompts a model',
  interaction: 'exchanges information',
  prediction: 'forecasts from history',
  computation: 'runs a program',
  lookup: 'obtains information',
  generation: 'produces assets',
};

function serves({ definitionTypes }: Carried, type: string): boolean {
  return definitionTypes.some((served) => served.type === type);
}

function follows({ recipes }: Carried, recipe: string): boolean {
  return recipes.includes(recipe);
}

function where(holds: boolean, ...lines: readonly string[]): readonly string[] {
  return holds ? lines : [];
}

const opening: Lines = () => [
  '# Start here',
  '',
  `You are the agent that builds a playbook with the person, tests what you built, and sets up what its runs act on; Auto Runtime runs the playbook, and Studio manages it. This guide says ${whatTheStartGuideSays}.`,
];

function formatGuidesOf({ definitionTypes }: Carried): string {
  const guides = definitionTypes.map(({ guide }) => guide);
  return guides.length === 1 ? String(guides[0]) : `one of ${listedInWords(guides)}`;
}

function whatIsWritten(carried: Carried): string {
  return serves(carried, 'workflow') ? 'a function or a workflow' : 'a function';
}

const whereToGo: Lines = (carried) => [
  '',
  '## Where to go',
  '',
  '- What the words of a playbook mean: the guide terminology.',
  ...where(
    follows(carried, 'first-playbook'),
    '- To build a playbook from nothing: the recipe first-playbook, which names the guides its steps need.',
  ),
  ...where(
    carried.definitionTypes.length > 0,
    `- To write ${whatIsWritten(carried)}: the guide of its type, ${formatGuidesOf(carried)}. Each says how its document is written, with its examples and bounds${carried.pages ? ', and how its page shows the person its results' : ''}.`,
  ),
  ...where(
    follows(carried, 'connect-a-service'),
    "- To connect a service and set it up for the playbook's runs: the recipe connect-a-service.",
  ),
  ...where(
    follows(carried, 'give-tools'),
    '- To give a function the tools of a connected service: the recipe give-tools.',
  ),
  ...where(
    follows(carried, 'schedule'),
    '- To start a workflow on its own, at set times or whenever an event arrives: the recipe schedule.',
  ),
  ...where(follows(carried, 'keep'), '- To keep something for later, and read it back: the recipe keep.'),
  `- The filters a template may use: the guide templates.${carried.pages ? ' How a page is written: the guide page.' : ''}`,
  '',
  'get_guide reads any of them, and its description names the recipes this connection can follow. A tool that cannot do what was asked says why and what to change.',
];

function functionTypesSentence({ definitionTypes }: Carried): readonly string[] {
  const inWords = definitionTypes.flatMap(({ type }) => {
    const purpose = purposeOfEachFunctionType[type];
    return purpose === undefined ? [] : [`${type} ${purpose}`];
  });
  return inWords.length === 0 ? [] : [`Its function types: ${listedInWords(inWords)}.`];
}

const whatAPlaybookIsMadeOf: Lines = (carried) => [
  '',
  '## What a playbook is made of',
  '',
  'A playbook holds work that keeps running after a conversation, in any line of business: one responsibility, such as reviewing campaign briefs or keeping a backlog of experiments ranked. It contains one brain, its reusable functions, and its workflows; runs belong to the playbook.',
  ...where(
    carried.definitionTypes.length > 0,
    '',
    [
      ...functionTypesSentence(carried),
      ...where(
        serves(carried, 'lookup'),
        'A lookup function fetches what a reasoning function interprets.',
        "What the person wants kept is the output of a run, read back with a lookup of that definition's runs.",
      ),
      ...where(serves(carried, 'reasoning'), 'A reasoning function names a model that list_models lists.'),
      ...where(
        serves(carried, 'workflow'),
        "A workflow puts the playbook's functions to work in steps: it waits for input, it can start on a schedule or event, and run_definition runs it.",
      ),
    ].join(' '),
  ),
  ...where(
    carried.pages,
    '',
    'Every workflow and function takes a page that shows the person its results, run by run and over time.',
  ),
];

const whatAWorkflowOwns: Lines = (carried) =>
  where(
    serves(carried, 'workflow'),
    '',
    '## What a workflow owns',
    '',
    'A workflow owns one job the business does again and again, with a result the person recognizes as done: a backlog kept ranked, an accepted idea made ready to run, a finished experiment measured and concluded. Before you write one, work out with the person what starts it, a time, an event or someone asking; what one run handles, an item, a case or a period; what done looks like; and which decisions stay with a person. One step is enough when that step finishes the job.',
    '',
    "The playbook's workflows, which list_definitions shows and Studio presents, are the person's list of jobs: read it back in their words, and keep off it anything that is not a job they want done again. These are not workflows:",
    '',
    '- A function the person wants to see answer, or that you want to test: run it with run_definition. A workflow is not a wrapper for a saved function.',
    ...where(
      serves(carried, 'interaction'),
      '- A question to a person, and the wait for their answer: an interaction function. The workflow that needs the answer calls it as a step, and owns what comes before and after.',
    ),
    '- Work that several jobs share, such as scoring an item or reading a board: a function, which each workflow calls as a step.',
    '- A check of a service, its connection or its setup, a test, or a change to saved definitions: your own work, below.',
    '',
    'Before you add a workflow, look for the one that owns the same job: a new source of input, a check inside the job or a handoff to a person usually belongs inside it.',
  );

const whatYouDoYourself: Lines = (carried) => [
  '',
  '## What you do yourself',
  '',
  "You are the playbook's developer. Testing, setting up and checking are your work, done with the tools below, and none of it is saved as a workflow. Which tools a connection lists depends on where it acts and on what its caller may do. The caller's own org's connection lists every tool the caller may call. One that manages the org's playbooks lists the tools that manage playbooks and connections, not those that work inside a playbook. One that acts inside a playbook lists only those.",
  '',
  '- To learn what a tool answers, call it with query_connection; a tool that may change something, with execute_connection, once the person agrees; dry_run checks the arguments without calling. Never make a function to look.',
  '- To test a function, run it with run_definition, and read its run with get_run and list_playbook_events. A run that called a tool may have changed something, so one that did not succeed is not run again under its id.',
  `- To set a service up for the playbook's runs, such as a team's statuses, a channel or a label, do it with the person before the first run, through the tools of the connection${follows(carried, 'connect-a-service') ? '; the recipe connect-a-service sets out how' : ''}. A run acts on what is there and sets nothing up.`,
  "- Where setting up or testing takes tools or access the runs do not need, connect them: ask for the access with the connection, as `more` of add_connection, or add the service's own MCP server or HTTP API by hand, so that you do the work here rather than send the person into the service.",
  '- A check a run must make each time, such as that an item is still where the job expects it, is a step of the workflow that owns the job. A check made before the first run, or when something at the service changes, is yours.',
];

const connectingAService: Lines = () => [
  '',
  '## Connecting a service',
  '',
  "search finds the provider of a service by its words, and add_connection connects it to the org's playbooks; the person approves on the page it links. Where no provider or server matches, add_connection can still take the service's own MCP server or HTTP API, given by hand; a service with neither cannot be connected.",
];

const askingAPerson: Lines = (carried) =>
  where(
    serves(carried, 'interaction'),
    '',
    '## Asking a person',
    '',
    'Where a person must approve or decide, ask once where they want to be asked: through a connection that sends them a request and reads their reply, such as a chat, an email provider or a ticketing app, or through you, `deliver: agent`. An interaction function makes the request and waits; answer_interaction answers one held for an agent, once the person says what to answer; the interaction-function guide says how.',
  );

const sections: readonly Lines[] = [
  opening,
  whereToGo,
  whatAPlaybookIsMadeOf,
  whatAWorkflowOwns,
  whatYouDoYourself,
  connectingAService,
  askingAPerson,
];

export function startGuideOf(carried: Carried): Guide {
  return {
    name: startGuideName,
    title: 'Start here',
    description: whatTheStartGuideIsFor,
    text: `${sections.flatMap((lines) => lines(carried)).join('\n')}\n`,
  };
}

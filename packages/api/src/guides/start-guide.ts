import type { FunctionType } from '@on.auto/definitions';
import { articled, capitalized, listed as listedInWords } from '@on.auto/phrasing';

import type { DefinitionType, Guide } from './guide-shelf.ts';

export const startGuideName = 'start';

const whatTheStartGuideSays =
  'what a playbook is made of, what a workflow owns, what you do yourself, and which guide each task needs';

const whatTheStartGuideIsFor =
  'Where an agent begins: what a playbook is made of, what a workflow owns, what the agent does itself, and which guide each task needs.';

export interface Carried {
  readonly definitionTypes: readonly DefinitionType[];
  readonly pages: boolean;
  readonly events: boolean;
  readonly recipes: readonly string[];
}

export type StartCarried = Carried & { readonly cards: boolean };

type Lines = (carried: StartCarried) => readonly string[];

const whatEachPartDoes: Readonly<Record<string, string>> = {
  reasoning: 'it interprets, judges or writes',
  lookup: 'it reads what a connected service holds, or what earlier runs of the playbook produced',
  interaction: 'it asks a person and takes their answer, or has a service act',
  prediction: "it forecasts a quantity from the playbook's own history",
  computation: 'it calculates or transforms data exactly',
  generation: 'it makes an image or audio',
} satisfies Record<FunctionType, string>;

export function serves({ definitionTypes }: Carried, type: string): boolean {
  return definitionTypes.some((served) => served.type === type);
}

export function follows({ recipes }: Carried, recipe: string): boolean {
  return recipes.includes(recipe);
}

export function where(holds: boolean, ...lines: readonly string[]): readonly string[] {
  return holds ? lines : [];
}

export function inTurn(items: readonly string[], conjunction: string): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${conjunction} ${String(items.at(-1))}`;
}

export function partLinesOf({ definitionTypes }: Carried): readonly string[] {
  return definitionTypes.flatMap(({ type, noun }) => {
    const does = whatEachPartDoes[type];
    return does === undefined ? [] : [`- ${does}: ${articled(noun)}`];
  });
}

export function runningAtOnce(carried: Carried): readonly string[] {
  return [
    ...where(serves(carried, 'reasoning'), 'a reasoning function'),
    ...where(serves(carried, 'computation'), 'a computation function'),
    ...where(serves(carried, 'interaction'), 'an interaction function held for you (`deliver: agent`)'),
  ];
}

export function sentenceOver(subjects: readonly string[], alone: string, together: string): readonly string[] {
  if (subjects.length === 0) {
    return [];
  }
  return [
    subjects.length === 1
      ? `${capitalized(String(subjects[0]))} ${alone}.`
      : `${together}: ${inTurn(subjects, 'and')}.`,
  ];
}

function whenEachRuns(carried: Carried): readonly string[] {
  return [
    ...sentenceOver(
      runningAtOnce(carried),
      'runs at once, with nothing connected',
      'These run at once, with nothing connected',
    ),
    ...where(serves(carried, 'lookup'), 'A lookup function that reads a service needs its connection.'),
    ...where(
      serves(carried, 'interaction'),
      'An interaction function that goes through a service needs its connection.',
    ),
    ...where(serves(carried, 'prediction'), "A prediction function needs the playbook's history."),
  ];
}

function whatTheWorkflowOwns(carried: Carried): readonly string[] {
  const workflows = serves(carried, 'workflow');
  return [
    ...where(
      workflows,
      'A workflow runs the parts in order and hands each one what the parts before it answered.',
      "The order, the branches, the waits and what happens when a part fails are the workflow's, never a prompt's.",
    ),
    ...where(
      serves(carried, 'reasoning'),
      `A job that is one judgement is one reasoning function${workflows ? ', and one step is enough' : ''}.`,
    ),
    ...whenEachRuns(carried),
  ];
}

function changedPartsOf(carried: Carried): readonly string[] {
  return [
    ...where(serves(carried, 'lookup'), 'a read'),
    ...where(serves(carried, 'computation'), 'a calculation'),
    ...where(serves(carried, 'interaction'), 'a question', 'an act'),
  ];
}

function whenAPlaybookChanges(carried: Carried): readonly string[] {
  const parts = changedPartsOf(carried);
  return where(
    serves(carried, 'reasoning') && serves(carried, 'workflow') && parts.length > 0,
    '',
    `When you change a playbook that exists, keep to the same rule. Where a reasoning function has come to hold ${inTurn(parts, 'or')}, give that part a function of its own type, and make it a step of the workflow. Do so once the person agrees, rather than write a longer prompt.`,
  );
}

const buildFromTheJob: Lines = (carried) => {
  const parts = partLinesOf(carried);
  const owned = whatTheWorkflowOwns(carried);
  return where(
    parts.length > 0,
    '',
    '## Build from the job',
    '',
    'Start from the job the person wants done again and again, not from a function. Break the job into its parts and give each part a function of the type its work needs, by what the part does, not by how it is done:',
    '',
    ...parts,
    ...where(owned.length > 0, '', owned.join(' ')),
    ...whenAPlaybookChanges(carried),
  );
};

const opening: Lines = (carried) => [
  '# Start here',
  '',
  `You are the agent that builds a playbook with the person, tests what you built, and sets up what its runs act on; Auto Runtime runs the playbook, and Studio manages it. This guide says ${partLinesOf(carried).length > 0 ? 'which function type each part of a job takes, ' : ''}${whatTheStartGuideSays}.`,
];

function formatGuidesOf({ definitionTypes }: Carried): string {
  const guides = definitionTypes.map(({ guide }) => guide);
  return guides.length === 1 ? String(guides[0]) : `one of ${listedInWords(guides)}`;
}

function whatIsWritten(carried: Carried): string {
  return serves(carried, 'workflow') ? 'a function or a workflow' : 'a function';
}

function asFunctionsOfTools(carried: Carried): string {
  const types = [
    ...where(serves(carried, 'lookup'), 'lookup'),
    ...where(serves(carried, 'interaction'), 'interaction'),
  ];
  return types.length === 0 ? '' : `, as ${inTurn(types, 'and')} functions`;
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
    `- To put the tools of a connected service to work${asFunctionsOfTools(carried)}: the recipe give-tools.`,
  ),
  ...where(
    follows(carried, 'schedule'),
    '- To start a workflow on its own, at set times or whenever an event arrives: the recipe schedule.',
  ),
  ...where(follows(carried, 'keep'), '- To keep something for later, and read it back: the recipe keep.'),
  `- The filters a template may use: the guide templates.${carried.pages ? ' How a page is written: the guide page.' : ''}`,
  ...where(
    serves(carried, 'workflow'),
    '- How a workflow starts on its own, by its triggers and their limits: the guide triggers.',
  ),
  ...where(carried.events, "- What the playbook's events hold, and how a filter names them: the guide events."),
  '',
  'get_guide reads any of them, and its description names the recipes this connection can follow. A tool that cannot do what was asked says why and what to change.',
];

function whatTheTypesTake(carried: Carried): readonly string[] {
  return [
    ...where(
      serves(carried, 'lookup'),
      "What the person wants kept is the output of a run, read back with a lookup of that definition's runs.",
    ),
    ...where(serves(carried, 'reasoning'), 'A reasoning function names a model that list_models lists.'),
    ...where(
      serves(carried, 'workflow'),
      "A workflow puts the playbook's functions to work in steps: it waits for input, it can start on a schedule or event, and run_definition runs it.",
    ),
  ];
}

const whatAPlaybookIsMadeOf: Lines = (carried) => [
  '',
  '## What a playbook is made of',
  '',
  'A playbook holds work that keeps running after a conversation, in any line of business: one responsibility, such as deciding each case that comes in or keeping a list of records ranked. It contains one brain, the collection of its reusable functions, and its workflows. Runs belong to the playbook.',
  ...where(whatTheTypesTake(carried).length > 0, '', whatTheTypesTake(carried).join(' ')),
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
    'A workflow owns one job the business does again and again, with a result the person recognizes as done: a list of records kept ranked, a case that came in decided and answered, a period that ended measured and reported. Before you write one, work out with the person what starts it, a time, an event or someone asking; what one run handles, an item, a case or a period; what done looks like; and which decisions stay with a person. One step is enough when that step finishes the job. Such a workflow is the job, not a wrapper: it is what runs that step again and again.',
    '',
    "The playbook's workflows, which list_definitions shows and Studio presents, are the person's list of jobs: read it back in their words, and keep off it anything that is not a job they want done again. These are not workflows:",
    '',
    '- A function the person wants to see answer, or that you want to test: run it with run_definition. A workflow made only to see a function answer is a wrapper, not a job.',
    ...where(
      serves(carried, 'interaction'),
      '- A question to a person, and the wait for their answer: an interaction function. The workflow that needs the answer calls it as a step, and owns what comes before and after.',
    ),
    '- Work that several jobs share, such as scoring an item or reading a list of records: a function, which each workflow calls as a step.',
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
  '- To learn what a tool answers, call it with query_connection; a tool that may change something, with execute_connection, once the person agrees; dry_run checks the arguments without calling. Never save a function only to see what a tool answers.',
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

const aCardMessage =
  "A message to a person can be a card with fields, a table, a chart and link buttons where its connection supports it, and the connection's tools say when it does.";

const askingAPerson: Lines = (carried) =>
  where(
    serves(carried, 'interaction'),
    '',
    '## Asking a person',
    '',
    'Where a person must approve or decide, ask once where they want to be asked: through a connection that sends them a request and reads their reply, such as a chat, an email provider or a ticketing app, or through you, `deliver: agent`. An interaction function makes the request and waits; answer_interaction answers one held for an agent, once the person says what to answer; the interaction-function guide says how.',
    ...where(carried.cards, '', aCardMessage),
  );

const sections: readonly Lines[] = [
  opening,
  buildFromTheJob,
  whereToGo,
  whatAPlaybookIsMadeOf,
  whatAWorkflowOwns,
  whatYouDoYourself,
  connectingAService,
  askingAPerson,
];

export function startGuideOf(carried: StartCarried): Guide {
  return {
    name: startGuideName,
    title: 'Start here',
    description: whatTheStartGuideIsFor,
    text: `${sections.flatMap((lines) => lines(carried)).join('\n')}\n`,
  };
}

import { inDefinitionTypeOrder } from '@on.auto/definitions';
import { isKeyHolder } from '@on.auto/identity';
import type { CallerIdentity } from '@on.auto/operations';
import { listed as listedInWords } from '@on.auto/phrasing';

export type McpEndpoint = 'org' | 'playbook' | 'own org' | 'directory';

export interface DefinitionType {
  readonly type: string;
  readonly noun: string;
  readonly guide: string;
}

export interface ServedTools {
  readonly orgTools: readonly string[];
  readonly playbookTools: readonly string[];
}

export interface RecipeCalls {
  readonly name: string;
  readonly calls: readonly string[];
}

export interface ActingAs {
  readonly caller: CallerIdentity;
  readonly org: string;
}

interface Serving {
  readonly endpoint: McpEndpoint;
  readonly listed: (name: string) => boolean;
  readonly definitionTypes: readonly DefinitionType[];
  readonly pages: boolean;
  readonly reasoning: DefinitionType | undefined;
  readonly followed: (recipe: string) => boolean;
}

type Sentences = (serving: Serving) => readonly string[];

const reasoningFunctionType = 'reasoning';

const workflowType = 'workflow';

const whatAWorkflowUses = "A workflow's steps use the playbook's functions";

const purposeOfEachFunctionType: Readonly<Record<string, string>> = {
  reasoning: 'prompts a model',
  interaction: 'exchanges information',
  prediction: 'forecasts from history',
  computation: 'runs a program',
  lookup: 'obtains information',
  generation: 'produces assets',
};

const whatAFunctionTypeAlsoNeedsSaid: Readonly<Record<string, readonly string[]>> = {
  lookup: [
    'A lookup function fetches what a reasoning function interprets.',
    "What the person wants kept is the output of a run, read back with a lookup of that definition's runs.",
  ],
};

function functionTypesInWords(definitionTypes: readonly DefinitionType[]): readonly string[] {
  return definitionTypes.flatMap(({ type }) => {
    const purpose = purposeOfEachFunctionType[type];
    return purpose === undefined ? [] : [`${type} ${purpose}`];
  });
}

const functionTypes: Sentences = ({ definitionTypes }) => {
  const inWords = functionTypesInWords(inDefinitionTypeOrder(definitionTypes));
  return inWords.length === 0 ? [] : [`Its function types: ${listedInWords(inWords)}.`];
};

const whatTheFunctionTypesAlsoNeedSaid: Sentences = ({ definitionTypes }) =>
  inDefinitionTypeOrder(definitionTypes).flatMap(({ type }) => whatAFunctionTypeAlsoNeedsSaid[type] ?? []);

const workflows: Sentences = ({ definitionTypes, listed }) =>
  definitionTypes.some(({ type }) => type === workflowType)
    ? [
        'A workflow waits for input and can start on a schedule or event.',
        listed('run_definition') ? `${whatAWorkflowUses}, and run_definition runs it.` : `${whatAWorkflowUses}.`,
      ]
    : [];

const whatAPageIs: Sentences = (serving) =>
  serving.pages
    ? ['Every workflow and function takes a page that shows the person its results, run by run and over time.']
    : [];

export const whatThisServerIsFor = [
  'A playbook holds work that keeps running after a conversation, in any line of business.',
  'Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client.',
  'A playbook contains one brain (its reusable functions) and workflows; runs belong to the playbook.',
];

const whenAToolCannot = 'A tool that cannot do what was asked says why and what to change.';

function playbooksClause({ listed }: Serving, shows: string): readonly string[] {
  const shown = listed('list_playbooks') ? [`list_playbooks shows ${shows}`] : [];
  const made = listed('create_playbook') ? [`create_playbook makes ${shown.length === 0 ? 'a playbook' : 'one'}`] : [];
  return [...shown, ...made];
}

function joinedClauses(opening: string, playbooks: readonly string[], rest: readonly string[]): string {
  const playbookWords = playbooks.length === 0 ? '' : `: ${playbooks.join(' and ')}`;
  const restWords = rest.map((clause) => `; ${clause}`).join('');
  return `${opening}${playbookWords}${restWords}.`;
}

const ownOrg = (serving: Serving) =>
  joinedClauses("The org is the caller's own", playbooksClause(serving, 'its playbooks'), []);

const whatTheConnectionDoes: Readonly<Record<McpEndpoint, (serving: Serving) => string>> = {
  'own org': ownOrg,
  directory: ownOrg,
  org: (serving) =>
    joinedClauses("This connection manages the org's playbooks", playbooksClause(serving, 'them'), [
      "each playbook's definitions are made on /orgs/{org}/playbooks/{playbook}/mcp",
    ]),
  playbook: () => 'This connection acts inside one playbook.',
};

const connection: Sentences = (serving) => [whatTheConnectionDoes[serving.endpoint](serving)];

const modelsBeforeWriting: Sentences = ({ reasoning, listed }) =>
  reasoning !== undefined && listed('list_models') && !listed('search')
    ? ['list_models lists the models this server can call, which a reasoning function names.']
    : [];

function overviewWords(serving: Serving): string {
  return serving.pages ? 'a function or workflow takes an overview' : 'a definition takes an overview';
}

const guides: Sentences = (serving) => [
  serving.listed('create_definition')
    ? `get_guide holds each definition's format; ${overviewWords(serving)}.`
    : 'get_guide explains these words and the format of each definition.',
];

const firstPlaybookRecipe = 'first-playbook';

const whereToStart: Sentences = ({ followed }) =>
  followed(firstPlaybookRecipe)
    ? [`The guide ${firstPlaybookRecipe} sets out how a playbook is built, and names the guides its steps need.`]
    : [];

const connectingAService = [
  "search finds the provider of a service by its words, and add_connection connects it to the org's playbooks; the person approves on the page it links.",
  "Where no provider or server matches, add_connection can still take the service's own MCP server or HTTP API, given by hand; a service with neither cannot be connected.",
];

const connections: Sentences = ({ listed }) => (listed('search') && listed('add_connection') ? connectingAService : []);

const answeringWhatRunsWaitOn: Sentences = ({ listed }) =>
  listed('answer_interaction') ? ['answer_interaction answers what a run waits on.'] : [];

const closing: Sentences = () => [whenAToolCannot];

const orientation: readonly Sentences[] = [
  functionTypes,
  whatTheFunctionTypesAlsoNeedSaid,
  workflows,
  whatAPageIs,
  connection,
  modelsBeforeWriting,
  guides,
  whereToStart,
  connections,
  answeringWhatRunsWaitOn,
  closing,
];

function namesOf(tools: ServedTools): readonly string[] {
  return [...tools.orgTools, ...tools.playbookTools];
}

export function recipesFollowedWith<Calls extends RecipeCalls>(
  tools: ServedTools,
  recipes: readonly Calls[],
): readonly Calls[] {
  const names = namesOf(tools);
  return recipes.filter(({ calls }) => calls.every((name) => names.includes(name)));
}

function callerInWords(caller: CallerIdentity): string {
  return isKeyHolder(caller) ? `the key ${caller.id}` : `${caller.name} (${caller.id})`;
}

function whomTheConnectionActsAs({ caller, org }: ActingAs): string {
  return `This connection acts as ${callerInWords(caller)} in the org ${org}.`;
}

interface ServedBeside {
  readonly pages?: boolean;
  readonly recipes?: readonly RecipeCalls[];
}

export function instructionsFor(
  endpoint: McpEndpoint,
  tools: ServedTools,
  definitionTypes: readonly DefinitionType[],
  { pages = false, recipes = [] }: ServedBeside = {},
): string {
  const names = namesOf(tools);
  const followable = new Set(recipesFollowedWith(tools, recipes).map(({ name }) => name));
  const serving: Serving = {
    endpoint,
    listed: (name) => names.includes(name),
    definitionTypes,
    pages,
    reasoning: definitionTypes.find(({ type }) => type === reasoningFunctionType),
    followed: (recipe) => followable.has(recipe),
  };
  return [...whatThisServerIsFor, ...orientation.flatMap((sentences) => sentences(serving))].join(' ');
}

interface ServedDefinitions extends ServedBeside {
  readonly definitionTypes: readonly DefinitionType[];
  readonly pages: boolean;
}

export function instructionsActingAs(
  actingAs: ActingAs,
  endpoint: McpEndpoint,
  tools: ServedTools,
  { definitionTypes, pages, recipes = [] }: ServedDefinitions,
): string {
  return `${whomTheConnectionActsAs(actingAs)} ${instructionsFor(endpoint, tools, definitionTypes, { pages, recipes })}`;
}

import { functionTypeOrder } from '@on.auto/definitions';
import { isKeyHolder } from '@on.auto/identity';
import type { CallerIdentity } from '@on.auto/operations';
import { listed as listedInWords } from '@on.auto/phrasing';

export type McpEndpoint = 'org' | 'playbook' | 'own org';

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
  readonly reasoning: DefinitionType | undefined;
}

type Sentences = (serving: Serving) => readonly string[];

const reasoningFunctionType = 'reasoning';

const workflowType = 'workflow';

const pageType = 'page';

const whatIsAskedOfAPlaybook = 'What the person asks the playbook to do is a workflow, its functions the steps';

const purposeOfEachFunctionType: Readonly<Record<string, string>> = {
  reasoning: 'prompts a model',
  interaction: 'exchanges information',
  prediction: 'forecasts from history',
  recall: 'retrieves run results',
  computation: 'runs a program',
  lookup: 'obtains information',
  memory: 'remembers and recalls',
  generation: 'produces assets',
};

const whatAFunctionTypeAlsoNeedsSaid: Readonly<Record<string, string>> = {
  lookup: 'A lookup function fetches and a reasoning function interprets, never fetching its own input.',
  recall: 'What the person wants kept goes in a recall function for anyone or a workflow to ask later, not your notes.',
  memory: 'Remember what the person wants kept in a memory function, not your notes.',
};

const familyOrder: readonly string[] = functionTypeOrder;

function familyRankOf({ type }: DefinitionType): number {
  const rank = familyOrder.indexOf(type);
  return rank === -1 ? familyOrder.length : rank;
}

function inFamilyOrder(definitionTypes: readonly DefinitionType[]): readonly DefinitionType[] {
  return definitionTypes.toSorted((one, other) => familyRankOf(one) - familyRankOf(other));
}

function functionTypesInWords(definitionTypes: readonly DefinitionType[]): readonly string[] {
  return definitionTypes.flatMap(({ type }) => {
    const purpose = purposeOfEachFunctionType[type];
    return purpose === undefined ? [] : [`${type} ${purpose}`];
  });
}

const functionTypes: Sentences = ({ definitionTypes }) => {
  const inWords = functionTypesInWords(inFamilyOrder(definitionTypes));
  return inWords.length === 0 ? [] : [`Its function types: ${listedInWords(inWords)}.`];
};

const whatTheFunctionTypesAlsoNeedSaid: Sentences = ({ definitionTypes }) =>
  inFamilyOrder(definitionTypes).flatMap(({ type }) => whatAFunctionTypeAlsoNeedsSaid[type] ?? []);

const workflows: Sentences = ({ definitionTypes, listed }) =>
  definitionTypes.some(({ type }) => type === workflowType)
    ? [
        'A workflow waits for input and can start on a schedule or event.',
        listed('run_definition')
          ? `${whatIsAskedOfAPlaybook}; run the workflow and show its result.`
          : `${whatIsAskedOfAPlaybook}.`,
      ]
    : [];

function servesPages({ definitionTypes }: Serving): boolean {
  return definitionTypes.some(({ type }) => type === pageType);
}

const pages: Sentences = (serving) =>
  servesPages(serving)
    ? ['A page shows the person the results of a workflow or function, run by run and over time.']
    : [];

export const whatThisServerIsFor = [
  'Whatever the person wants done that keeps working after this conversation, however they put it and in any line of business, is a playbook here, not a document, plan, note or one-off answer.',
  'Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client.',
  'A playbook contains one brain (its reusable functions) and workflows; runs belong to the playbook.',
];

const howToAnswer =
  "Say what was done and what the person can do next in the words of playbooks, functions, workflows and runs, not tools' names, fields or rules; an id or status only where needed to act.";

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

const whatTheConnectionDoes: Readonly<Record<McpEndpoint, (serving: Serving) => string>> = {
  'own org': (serving) => joinedClauses("The org is the caller's own", playbooksClause(serving, 'its playbooks'), []),
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
  return servesPages(serving) ? 'give a function or workflow an overview' : 'give it an overview';
}

const guides: Sentences = (serving) => [
  serving.listed('create_definition')
    ? `Read a definition's format with get_guide; ${overviewWords(serving)}.`
    : 'get_guide explains these words and the format of each definition.',
];

const connectingAService = [
  "A service a playbook will use is connected here, whatever connector you have: asked to connect, link, sign in to or use one, call search with its words, then add_connection with the provider's name; the person approves on the page it links.",
  'Say a service cannot be connected only if no provider or server matches.',
];

const connections: Sentences = ({ listed }) => (listed('search') && listed('add_connection') ? connectingAService : []);

const answeringWhatRunsWaitOn: Sentences = ({ listed }) =>
  listed('answer_interaction')
    ? ['When the person answers what a run waits on, use answer_interaction, not a new run.']
    : [];

const closing: Sentences = () => [howToAnswer, whenAToolCannot];

const orientation: readonly Sentences[] = [
  functionTypes,
  whatTheFunctionTypesAlsoNeedSaid,
  workflows,
  pages,
  connection,
  modelsBeforeWriting,
  guides,
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

export function instructionsFor(
  endpoint: McpEndpoint,
  tools: ServedTools,
  definitionTypes: readonly DefinitionType[],
): string {
  const names = namesOf(tools);
  const serving: Serving = {
    endpoint,
    listed: (name) => names.includes(name),
    definitionTypes,
    reasoning: definitionTypes.find(({ type }) => type === reasoningFunctionType),
  };
  return [...whatThisServerIsFor, ...orientation.flatMap((sentences) => sentences(serving))].join(' ');
}

export function instructionsActingAs(
  actingAs: ActingAs,
  endpoint: McpEndpoint,
  tools: ServedTools,
  definitionTypes: readonly DefinitionType[],
): string {
  return `${whomTheConnectionActsAs(actingAs)} ${instructionsFor(endpoint, tools, definitionTypes)}`;
}

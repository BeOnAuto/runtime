import { isKeyHolder } from '@on.auto/identity';
import type { CallerIdentity } from '@on.auto/operations';

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

const purposesByType: Readonly<Record<string, readonly string[]>> = {
  reasoning: ['A reasoning function has a prompt and calls a language model.'],
  interaction: ['An interaction function asks a system and answers at once, or a person and answers started.'],
  computation: ['A computation function runs a program: same input, same output.'],
  recall: [
    'Recall retrieves run results, definitions and events, never run inputs or tool calls.',
    'What the person wants kept goes in a recall function for anyone or a workflow to ask later, not your notes.',
  ],
  prediction: ["A prediction function answers from a model trained on the playbook's history."],
  workflow: ['A workflow runs functions in steps, waits for input and can start on a schedule or event.'],
};

export const whatThisServerIsFor = [
  'Whatever the person wants done that keeps working after this conversation, however they put it and in any line of business, is a playbook here, not a document, plan, note or one-off answer.',
  'Auto Runtime makes and runs playbooks; Studio manages them; your agent is a separate client.',
  'A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run alone or in workflows; runs belong to the playbook.',
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
      "a playbook's functions and workflows are made on its connection, /orgs/{org}/playbooks/{playbook}/mcp",
    ]),
  playbook: () => 'This connection acts inside one playbook.',
};

const purposes: Sentences = ({ definitionTypes }) => definitionTypes.flatMap(({ type }) => purposesByType[type] ?? []);

const connection: Sentences = (serving) => [whatTheConnectionDoes[serving.endpoint](serving)];

const modelsBeforeWriting: Sentences = ({ reasoning, listed }) =>
  reasoning !== undefined && listed('list_models') && !listed('search')
    ? ['list_models lists the models this server can call, which a reasoning function names.']
    : [];

const guides: Sentences = ({ listed }) => [
  listed('create_definition')
    ? "Read a definition's format with get_guide; give it an overview."
    : 'get_guide explains these words and the format of each definition.',
];

const connectingAService = [
  "A service a playbook will use is connected here, whatever connector you have: asked to connect, link, sign in to or use one, call search with its words, then add_connection with the provider's name; the person approves on the page it links.",
  'Say a service cannot be connected only if no provider or server matches.',
];

const connections: Sentences = ({ listed }) => (listed('search') && listed('add_connection') ? connectingAService : []);

const answeringWhatRunsWaitOn: Sentences = ({ listed }) =>
  listed('answer_interaction')
    ? [
        'When the person approves, rejects or otherwise answers what a run waits on, use answer_interaction, not a new run.',
      ]
    : [];

const closing: Sentences = () => [howToAnswer, whenAToolCannot];

const orientation: readonly Sentences[] = [
  purposes,
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

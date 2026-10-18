import { articled } from '@on.auto/operations';

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

interface Serving {
  readonly endpoint: McpEndpoint;
  readonly listed: (name: string) => boolean;
  readonly definitionTypes: readonly DefinitionType[];
  readonly reasoning: DefinitionType | undefined;
  readonly recipes: readonly RecipeCalls[];
}

type Sentences = (serving: Serving) => readonly string[];

const reasoningFunctionType = 'reasoning';

const purposesByType: Readonly<Record<string, readonly string[]>> = {
  reasoning: ['A reasoning function has a prompt and calls a language model.'],
  interaction: ['An interaction function asks a system and answers at once, or asks a person and answers started.'],
  computation: ['A computation function runs a program on its input and gives the same output every time.'],
  recall: [
    'Recall retrieves retained run results, definitions and events, never run inputs or tool calls.',
    'What the person wants kept goes in a recall function, for anyone or a workflow to ask later, not your own notes.',
  ],
  prediction: [
    "A prediction function answers from a model trained on the playbook's history; a build, the input { build: {} }, answers started.",
  ],
  workflow: ['A workflow runs functions in steps, waits for input and can start on a schedule or on an event.'],
};

export const whatAPlaybookIs = [
  'Auto Runtime executes playbooks; Studio manages them; your agent is a separate client.',
  'A playbook contains one brain (its reusable functions) and workflows. The brain shares its lifecycle. Functions run directly or through workflows; runs belong to the playbook.',
];

const pagedReads = ['list_runs', 'list_playbook_events', 'list_interactions'];

const howToAnswer = [
  'Say what was done and what the person can do next in the words of playbooks, functions, workflows and runs,',
  "not the tools' names, fields or rules, and an id or status only when needed to act.",
].join(' ');

const whenAToolCannot = 'A tool that cannot do what was asked says why and what to change.';

function inTurn(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${String(items.at(-1))}`;
}

function playbooksClause({ listed }: Serving, shows: string): readonly string[] {
  const shown = listed('list_playbooks') ? [`list_playbooks shows ${shows}`] : [];
  const made = listed('create_playbook') ? [`create_playbook makes ${shown.length === 0 ? 'a playbook' : 'one'}`] : [];
  return [...shown, ...made];
}

function joinedClauses(opening: string, playbooks: readonly string[], rest: readonly string[]): string {
  const playbookWords = playbooks.length === 0 ? '' : `: ${playbooks.join(' and ')}`;
  const restWords = rest.map((clause) => `, and ${clause}`).join('');
  return `${opening}${playbookWords}${restWords}.`;
}

const whatTheConnectionDoes: Readonly<Record<McpEndpoint, (serving: Serving) => string>> = {
  'own org': (serving) =>
    joinedClauses("This connection acts in the caller's own org", playbooksClause(serving, 'its playbooks'), []),
  org: (serving) =>
    joinedClauses('This connection manages the playbooks of one org', playbooksClause(serving, 'them'), [
      "a playbook's functions and workflows are made on the playbook's own connection, /orgs/{org}/playbooks/{playbook}/mcp",
    ]),
  playbook: () => 'This connection acts inside one playbook.',
};

const purposes: Sentences = ({ definitionTypes }) => definitionTypes.flatMap(({ type }) => purposesByType[type] ?? []);

const connection: Sentences = (serving) => [whatTheConnectionDoes[serving.endpoint](serving)];

const modelsBeforeWriting: Sentences = ({ reasoning, listed }) =>
  reasoning !== undefined && listed('list_models') && !listed('search')
    ? ['list_models lists the models this server can call, which a reasoning function names.']
    : [];

const guides: Sentences = ({ listed, recipes }) => {
  if (!listed('create_definition')) {
    return ['get_guide holds what these words mean and how each kind of definition is written.'];
  }
  const served = recipes.map(({ name }) => name);
  const reading = 'Before writing a definition, read its format with get_guide';
  return [served.length === 0 ? `${reading}.` : `${reading}, which also holds the recipes: ${inTurn(served)}.`];
};

function callingWords(listed: Serving['listed']): string {
  const executing = listed('execute');
  const dryRunning = listed('dry_run');
  if (executing && dryRunning) {
    return '; execute calls one and shows its answer, and dry_run what it would check';
  }
  if (executing) {
    return '; execute calls one and shows its answer';
  }
  return dryRunning ? '; dry_run shows what a call of one would check' : '';
}

const modelsAndTools: Sentences = ({ reasoning, listed }) => {
  if (reasoning === undefined || !listed('search')) {
    return [];
  }
  const tools = `may name tools that search finds${callingWords(listed)}`;
  return [
    listed('list_models')
      ? `A reasoning function names a model that list_models lists and ${tools}.`
      : `A reasoning function names a model this server can call, as the ${reasoning.guide} guide says, and ${tools}.`,
  ];
};

const connections: Sentences = ({ listed }) =>
  listed('add_connection') ? ['add_connection adds a provider, or a server by hand; a person approves.'] : [];

const typesThatFinishLater: ReadonlySet<string> = new Set(['workflow']);

const runsThatFinishLater: Sentences = ({ listed, definitionTypes }) => {
  const finishingLater = definitionTypes
    .filter(({ type }) => typesThatFinishLater.has(type))
    .map(({ noun }) => articled(noun));
  return listed('get_run') && finishingLater.length > 0
    ? [`A run of ${finishingLater.join(' or ')} answers started; get_run shows whether it ended or still waits.`]
    : [];
};

const answeringWhatRunsWaitOn: Sentences = ({ listed }) =>
  listed('answer_interaction')
    ? [
        'When the person approves, rejects or otherwise answers what a run waits on, answer its request with answer_interaction, not a new run.',
      ]
    : [];

const paging: Sentences = ({ listed }) => {
  const paged = listed('list_interactions') ? 'Runs, events and requests' : 'Runs and events';
  return pagedReads.some((name) => listed(name))
    ? [`${paged} come in pages; read on only when the person needs more.`]
    : [];
};

const closing: Sentences = () => [howToAnswer, whenAToolCannot];

const orientation: readonly Sentences[] = [
  purposes,
  connection,
  modelsBeforeWriting,
  guides,
  modelsAndTools,
  connections,
  runsThatFinishLater,
  answeringWhatRunsWaitOn,
  paging,
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

export function instructionsFor(
  endpoint: McpEndpoint,
  tools: ServedTools,
  definitionTypes: readonly DefinitionType[],
  recipes: readonly RecipeCalls[],
): string {
  const names = namesOf(tools);
  const serving: Serving = {
    endpoint,
    listed: (name) => names.includes(name),
    definitionTypes,
    reasoning: definitionTypes.find(({ type }) => type === reasoningFunctionType),
    recipes: recipesFollowedWith(tools, recipes),
  };
  return [...whatAPlaybookIs, ...orientation.flatMap((sentences) => sentences(serving))].join(' ');
}

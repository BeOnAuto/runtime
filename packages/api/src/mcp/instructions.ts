import { isKeyHolder } from '@on.auto/identity';
import type { CallerIdentity } from '@on.auto/operations';

import { startGuideName } from '../guides/start-guide.ts';

export type McpEndpoint = 'org' | 'playbook' | 'own org' | 'directory';

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
}

export const whatThisServerIsFor = [
  'A playbook holds work that keeps running after a conversation, in any line of business.',
  'Auto Runtime makes and runs playbooks; Studio manages them; the agent is a separate client.',
  'A playbook contains one brain (its reusable functions) and workflows; runs belong to the playbook.',
];

const whereToBegin = `Before you build or change anything, read the guide ${startGuideName} with get_guide: it says which function type each part of a job takes.`;

const buildFromTheJob =
  'Build from the job: each part is a function of the type its work needs, and a workflow runs the parts in order.';

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

function sentencesFor(endpoint: McpEndpoint, tools: ServedTools): readonly string[] {
  const names = namesOf(tools);
  const serving: Serving = { endpoint, listed: (name) => names.includes(name) };
  return [whereToBegin, buildFromTheJob, ...whatThisServerIsFor, whatTheConnectionDoes[endpoint](serving)];
}

export function instructionsFor(endpoint: McpEndpoint, tools: ServedTools): string {
  return [...sentencesFor(endpoint, tools), whenAToolCannot].join(' ');
}

export function instructionsActingAs(actingAs: ActingAs, endpoint: McpEndpoint, tools: ServedTools): string {
  return [...sentencesFor(endpoint, tools), whomTheConnectionActsAs(actingAs), whenAToolCannot].join(' ');
}

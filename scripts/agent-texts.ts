import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startGuideName } from '@on.auto/api';
import { agentTextsOf, type AgentText, type ServedSurface } from '@on.auto/api/testing';
import { servedByAThrowawayServer, type ServedToAnAgent } from '@on.auto/server/served-to-an-agent';

export const onboardingPath: readonly string[] = [startGuideName, 'first-playbook', 'give-tools', 'get-started'];

const regenerating = 'pnpm agent-texts';

function inTurn(names: readonly string[]): string {
  return `${names.slice(0, -1).join(', ')} and ${names.slice(-1).join('')}`;
}

const about = [
  'The texts that a server of this release gives an agent, as the agent receives them, each with its SHA-256:',
  "the instructions, every tool's title, description and argument descriptions, every guide and recipe, every prompt,",
  'and the answers to the first calls on a new org.',
  `${regenerating} writes it from what a throwaway server serves, and a test fails while it is stale,`,
  "so a change to any of these texts shows in this file's diff.",
  'The words of other outcomes, of refusals and of failed runs are worded from what each call is given and answers,',
  'and the tests of the package that words them pin them.',
].join(' ');

const tiers = {
  '1': 'Always received: the instructions, and in tools/list the title, the description and the argument descriptions of every tool.',
  '2': `The onboarding path, what an agent reads from its first call to its first saved definition: the answers to the first calls on a new org, and the guides and prompts ${inTurn(onboardingPath)}.`,
  '3': 'Every other text listed here: the other guides, recipes and prompts.',
};

const placeholders = [
  "{origin} stands for the server's own address.",
  'Where a text is received, {org} and {playbook} stand for the ids in the address, and a required argument of a prompt in braces for the words the person gives.',
  'The instructions are as the page at /debug shows them: on a real connection they hold one more sentence, just before the last, which names the caller and the org.',
].join(' ');

function agentTextsDocumentOf(texts: readonly AgentText[]): string {
  return `${JSON.stringify({ about, tiers, placeholders, texts }, null, 2)}\n`;
}

function namesServedIn({ connections }: ServedSurface): ReadonlySet<string> {
  return new Set(connections.flatMap(({ guides, prompts }) => [...guides, ...prompts].map(({ name }) => name)));
}

export function requireTheOnboardingPathServed(surface: ServedSurface): void {
  const served = namesServedIn(surface);
  const unserved = onboardingPath.filter((name) => !served.has(name));
  if (unserved.length > 0) {
    throw new Error(`The onboarding path names ${unserved.join(', ')}, which the server does not serve`);
  }
}

export async function servedDocument(
  served: () => Promise<ServedToAnAgent> = servedByAThrowawayServer,
): Promise<string> {
  const { surface } = await served();
  requireTheOnboardingPathServed(surface);
  return agentTextsDocumentOf(agentTextsOf(surface, onboardingPath));
}

export function writeAgentTexts(path: string, document: string): 'updated' | 'unchanged' {
  if (existsSync(path) && readFileSync(path, 'utf8') === document) return 'unchanged';
  writeFileSync(path, document);
  return 'updated';
}

export function checkAgentTexts(path: string, document: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== document) {
    throw new Error(`The list of the texts an agent reads is missing or stale at ${path}. Run ${regenerating}.`);
  }
}

export async function runAgentTexts(
  commandArguments: readonly string[],
  path: string,
  served?: () => Promise<ServedToAnAgent>,
): Promise<void> {
  if (commandArguments.length === 0) {
    writeAgentTexts(path, await servedDocument(served));
  } else if (commandArguments.length === 1 && commandArguments[0] === '--check') {
    checkAgentTexts(path, await servedDocument(served));
  } else {
    throw new Error(`Usage: ${regenerating} [--check]`);
  }
}

if (import.meta.main) {
  await runAgentTexts(process.argv.slice(2), resolve(import.meta.dirname, '../docs/assets/agent-texts.json'));
}

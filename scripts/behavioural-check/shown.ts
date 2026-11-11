import { instructionsActingAs, type ActingAs } from '@on.auto/api';
import { agentTextsOf, originPlaceholder, type AgentText, type ServedSurface } from '@on.auto/api/testing';
import { Schema } from 'effect';

import { onboardingPath } from '../agent-texts.ts';
import type { Shown } from './prompts.ts';

const localOrigin = 'http://localhost:5555';

const someoneConnected: ActingAs = {
  caller: { id: 'person:user_1', name: 'Alex Doe', org: 'org_1', permissions: [], playbooks: '*' },
  org: 'org_1',
};

const NamedSchema = Schema.Struct({ name: Schema.String });

export function required<T>(value: T | undefined, missing: string): T {
  if (value === undefined) {
    throw new Error(missing);
  }
  return value;
}

function withTheOrigin(text: string): string {
  return text
    .replaceAll(originPlaceholder, localOrigin)
    .replaceAll(encodeURIComponent(originPlaceholder), encodeURIComponent(localOrigin));
}

export function shownOf({ connections, answers }: ServedSurface, search: unknown): Shown {
  const own = required(
    connections.find(({ endpoint }) => endpoint === 'own org'),
    'The server serves no connection to the caller’s own org',
  );
  const guide = (name: string) =>
    required(
      own.guides.find((served) => served.name === name),
      `The server serves no guide ${name}`,
    ).text;
  const welcome = required(
    answers.find(({ tool }) => tool === 'list_playbooks'),
    'The server gave no answer to list_playbooks on a new org',
  );
  return {
    instructions: instructionsActingAs(someoneConnected, own.endpoint, {
      orgTools: own.tools.map(({ name }) => name),
      playbookTools: [],
    }),
    tools: own.listing.map((listed) => ({ name: Schema.decodeUnknownSync(NamedSchema)(listed).name, listed })),
    welcome: withTheOrigin(welcome.text),
    start: guide('start'),
    firstPlaybook: guide('first-playbook'),
    search: JSON.stringify(search),
  };
}

function isTheOwnOrgsInstructions({ received }: AgentText): boolean {
  return received.some(({ as, on }) => as === 'instructions' && on.includes('/mcp'));
}

export function textsSent(surface: ServedSurface, shown: Shown, prompts: readonly string[]): readonly string[] {
  return agentTextsOf(surface, onboardingPath)
    .filter((text) => {
      const sent = isTheOwnOrgsInstructions(text) ? shown.instructions : withTheOrigin(text.lines.join('\n'));
      return prompts.some((prompt) => prompt.includes(sent) || prompt.includes(JSON.stringify(sent)));
    })
    .map(({ sha256 }) => sha256);
}

import { createHash } from 'node:crypto';

import { argumentsIn, type ShownArgument } from '../../debug/shown-tools.ts';
import type {
  PromptMessage,
  ServedAnswer,
  ServedConnection,
  ServedPrompt,
  ServedSurface,
  ServedTool,
} from './served-surface.ts';

type Tier = 1 | 2 | 3;

interface Receipt {
  readonly as: string;
  readonly on: readonly string[];
}

export interface AgentText {
  readonly sha256: string;
  readonly tier: Tier;
  readonly received: readonly Receipt[];
  readonly lines: readonly string[];
}

interface Received {
  readonly as: string;
  readonly on: string;
  readonly tier: Tier;
  readonly text: string;
}

const alwaysReceived: Tier = 1;

const onTheOnboardingPath: Tier = 2;

const received = (on: string, tier: Tier) => (as: string, text: string) => ({ as, on, tier, text });

function tierOf(name: string, onboarding: readonly string[]): Tier {
  return onboarding.includes(name) ? onTheOnboardingPath : 3;
}

function descriptionsIn(schema: unknown): number {
  if (typeof schema !== 'object' || schema === null) {
    return 0;
  }
  let count = 0;
  for (const [key, value] of Object.entries(schema)) {
    count += key === 'description' && typeof value === 'string' ? 1 : descriptionsIn(value);
  }
  return count;
}

function describedArgumentsOf({ name, inputSchema }: ServedTool): readonly ShownArgument[] {
  const described = argumentsIn(inputSchema).filter(({ description }) => description !== '');
  if (described.length !== descriptionsIn(inputSchema)) {
    throw new Error(`The input schema of ${name} holds a description that the page at /debug does not show`);
  }
  return described;
}

function toolReceived(tool: ServedTool, on: string): readonly Received[] {
  const listed = received(on, alwaysReceived);
  const { name } = tool;
  return [
    listed(`tool ${name}: title`, tool.title),
    listed(`tool ${name}: description`, tool.description),
    ...describedArgumentsOf(tool).map((argument) =>
      listed(`tool ${name}: argument ${argument.name}`, argument.description),
    ),
  ];
}

function messageReceived(name: string, message: PromptMessage): Pick<Received, 'as' | 'text'> {
  return message.kind === 'text'
    ? { as: `prompt ${name}: message`, text: message.text }
    : { as: `prompt ${name}: attached ${message.uri}`, text: message.text };
}

function promptReceived(prompt: ServedPrompt, on: string, onboarding: readonly string[]): readonly Received[] {
  const offered = received(on, tierOf(prompt.name, onboarding));
  return [
    offered(`prompt ${prompt.name}: title`, prompt.title),
    offered(`prompt ${prompt.name}: description`, prompt.description),
    ...prompt.arguments.map((argument) =>
      offered(`prompt ${prompt.name}: argument ${argument.name}`, argument.description),
    ),
    ...prompt.messages.map((message) => {
      const { as, text } = messageReceived(prompt.name, message);
      return offered(as, text);
    }),
  ];
}

function connectionReceived(connection: ServedConnection, onboarding: readonly string[]): readonly Received[] {
  const { path } = connection;
  return [
    received(path, alwaysReceived)('instructions', connection.instructions),
    ...connection.tools.flatMap((tool) => toolReceived(tool, path)),
    ...connection.prompts.flatMap((prompt) => promptReceived(prompt, path, onboarding)),
    ...connection.guides.map(({ name, text }) => received(path, tierOf(name, onboarding))(`guide ${name}`, text)),
  ];
}

function answerReceived({ tool, arguments: given, path, text }: ServedAnswer): Received {
  return received(path, onTheOnboardingPath)(`first answer of ${tool} ${JSON.stringify(given)}`, text);
}

function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function higherOf(one: Tier, other: Tier): Tier {
  return one <= other ? one : other;
}

interface Gathered {
  readonly tier: Tier;
  readonly text: string;
  readonly receipts: ReadonlyMap<string, readonly string[]>;
}

function gatheredWith(gathered: Gathered | undefined, { as, on, tier, text }: Received): Gathered {
  const receipts = new Map(gathered?.receipts);
  receipts.set(as, [...(receipts.get(as) ?? []), on]);
  return { tier: higherOf(gathered?.tier ?? tier, tier), text, receipts };
}

export function agentTextsOf(surface: ServedSurface, onboarding: readonly string[]): readonly AgentText[] {
  const every = [
    ...surface.answers.map((answer) => answerReceived(answer)),
    ...surface.connections.flatMap((connection) => connectionReceived(connection, onboarding)),
  ];
  const byDigest = new Map<string, Gathered>();
  for (const one of every) {
    const sha256 = digestOf(one.text);
    byDigest.set(sha256, gatheredWith(byDigest.get(sha256), one));
  }
  return [...byDigest].map(([sha256, { tier, text, receipts }]: readonly [string, Gathered]) => ({
    sha256,
    tier,
    received: [...receipts].map(([as, on]: readonly [string, readonly string[]]) => ({ as, on })),
    lines: text.split('\n'),
  }));
}

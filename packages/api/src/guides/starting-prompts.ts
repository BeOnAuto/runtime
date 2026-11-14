import type { GetPromptResult, McpServer } from '@modelcontextprotocol/server';

import { recipesFollowedWith, type RecipeCalls, type ServedTools } from '../mcp/instructions.ts';
import type { GuideShelf, RecipeArgument, RecipeWords } from './guide-shelf.ts';
import { wordsSchemaOf } from './recipe-prompts.ts';

export interface StartingPrompt extends RecipeCalls {
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly RecipeArgument[];
  readonly ask: (words: RecipeWords) => string;
}

const getStarted = {
  name: 'get-started',
  title: 'Get started with Auto',
  arguments: [],
  calls: ['create_playbook', 'create_definition', 'run_definition'],
} as const;

const startingPrompts: readonly StartingPrompt[] = [
  {
    ...getStarted,
    description:
      'Creates a first playbook with one function, runs it on a made-up example and links the run in Studio.',
    ask: () =>
      'Create a playbook in Auto with one function and run it on a made-up example. Ask me what the playbook is for and anything else you need first, then give me a link to the run in Studio.',
  },
];

const fromItsGoal =
  'Creates a first playbook from its goal, shows the goal in Studio, then gives it one function and runs it on a made-up example.';

const startingPromptsWhereGoalsAreTold: readonly StartingPrompt[] = [
  {
    ...getStarted,
    description: fromItsGoal,
    ask: () =>
      "Create a playbook in Auto. First ask me what it should achieve, how I'll know it worked, and what I want to be told about and where, then show me the goal in Studio. Once I say yes, give it one function and run it on a made-up example.",
  },
];

const startingPromptsWhereGoalsAreKept: readonly StartingPrompt[] = [
  {
    ...getStarted,
    description: fromItsGoal,
    ask: () =>
      "Create a playbook in Auto. First ask me what it should achieve and how I'll know it worked, then show me the goal in Studio. Once I say yes, give it one function and run it on a made-up example.",
  },
];

function startingPromptsOf(shelf: Pick<GuideShelf, 'named' | 'messages'>): readonly StartingPrompt[] {
  if (shelf.named('goals') === undefined) {
    return startingPrompts;
  }
  return shelf.messages ? startingPromptsWhereGoalsAreTold : startingPromptsWhereGoalsAreKept;
}

export function startingPromptsFollowedWith(
  served: ServedTools,
  shelf: Pick<GuideShelf, 'named' | 'messages'>,
): readonly StartingPrompt[] {
  return recipesFollowedWith(served, startingPromptsOf(shelf));
}

export function startingAnswerOf(prompt: StartingPrompt): (words: RecipeWords) => GetPromptResult {
  return (words) => ({ messages: [{ role: 'user', content: { type: 'text', text: prompt.ask(words) } }] });
}

export function serveStartingPrompts(
  server: Readonly<Pick<McpServer, 'registerPrompt'>>,
  served: ServedTools,
  shelf: Pick<GuideShelf, 'named' | 'messages'>,
): void {
  for (const prompt of startingPromptsFollowedWith(served, shelf)) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: wordsSchemaOf(prompt.arguments) },
      startingAnswerOf(prompt),
    );
  }
}

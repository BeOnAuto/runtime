import type { GetPromptResult, McpServer } from '@modelcontextprotocol/server';

import { recipesFollowedWith, type RecipeCalls, type ServedTools } from '../mcp/instructions.ts';
import type { RecipeArgument, RecipeWords } from './guide-shelf.ts';
import { wordsSchemaOf } from './recipe-prompts.ts';

export interface StartingPrompt extends RecipeCalls {
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly RecipeArgument[];
  readonly ask: (words: RecipeWords) => string;
}

const startingPrompts: readonly StartingPrompt[] = [
  {
    name: 'get-started',
    title: 'Get started with Auto',
    description:
      'Creates a first playbook with one function, runs it on a made-up example and links the run in Studio.',
    arguments: [],
    calls: ['create_playbook', 'create_definition', 'run_definition'],
    ask: () =>
      'Create a playbook in Auto with one function and run it on a made-up example. Ask me what the playbook is for and anything else you need first, then give me a link to the run in Studio.',
  },
];

export function startingPromptsFollowedWith(served: ServedTools): readonly StartingPrompt[] {
  return recipesFollowedWith(served, startingPrompts);
}

export function startingAnswerOf(prompt: StartingPrompt): (words: RecipeWords) => GetPromptResult {
  return (words) => ({ messages: [{ role: 'user', content: { type: 'text', text: prompt.ask(words) } }] });
}

export function serveStartingPrompts(server: Readonly<Pick<McpServer, 'registerPrompt'>>, served: ServedTools): void {
  for (const prompt of startingPromptsFollowedWith(served)) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: wordsSchemaOf(prompt.arguments) },
      startingAnswerOf(prompt),
    );
  }
}

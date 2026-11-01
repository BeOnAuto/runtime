import type { McpServer } from '@modelcontextprotocol/server';

import { recipesFollowedWith, type RecipeCalls, type ServedTools } from '../mcp/instructions.ts';
import type { RecipeArgument, RecipeWords } from './guide-shelf.ts';
import { wordsSchemaOf } from './recipe-prompts.ts';

interface StartingPrompt extends RecipeCalls {
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
      'Create a playbook in my Auto Runtime with one function and run it on a made-up example. Ask me what the playbook is for and anything else you need first, then give me a link to the run in Studio.',
  },
  {
    name: 'connect-a-service',
    title: 'Connect a service',
    description: 'Connects a service the team uses to Auto, and says what it can do once it is connected.',
    arguments: [
      { name: 'service', description: 'The service to connect, such as Slack or Google Drive', required: true },
    ],
    calls: ['add_connection'],
    ask: ({ service }) =>
      `Connect ${String(service)} to my Auto Runtime for my team, and once it is connected tell me what it can do.`,
  },
];

export function serveStartingPrompts(server: Readonly<Pick<McpServer, 'registerPrompt'>>, served: ServedTools): void {
  for (const prompt of recipesFollowedWith(served, startingPrompts)) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: wordsSchemaOf(prompt.arguments) },
      (words: RecipeWords) => ({
        messages: [{ role: 'user', content: { type: 'text', text: prompt.ask(words) } }],
      }),
    );
  }
}

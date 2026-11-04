import type { GetPromptResult, McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { Schema } from 'effect';

import { guideAddress, guideMediaType } from './guide-resources.ts';
import type { RecipeArgument, RecipeWords, ShelvedRecipe } from './guide-shelf.ts';

export function wordsSchemaOf(given: readonly RecipeArgument[]): StandardSchemaWithJSON<unknown, RecipeWords> {
  const fields = Object.fromEntries(
    given.map(({ name, required }) => [name, required ? Schema.String : Schema.optionalKey(Schema.String)]),
  );
  const jsonSchema = {
    type: 'object',
    properties: Object.fromEntries(given.map(({ name, description }) => [name, { type: 'string', description }])),
    required: given.filter(({ required }) => required).map(({ name }) => name),
  };
  const described = () => jsonSchema;
  const standard = Schema.toStandardSchemaV1(Schema.Struct(fields))['~standard'];
  return { '~standard': { ...standard, jsonSchema: { input: described, output: described } } };
}

type PromptMessage = GetPromptResult['messages'][number];

function formatMessageOf(format: ShelvedRecipe['format']): readonly PromptMessage[] {
  return format === undefined
    ? []
    : [
        {
          role: 'user',
          content: {
            type: 'resource',
            resource: { uri: guideAddress(format), mimeType: guideMediaType, text: format.text },
          },
        },
      ];
}

function promptOf(recipe: ShelvedRecipe): (words: RecipeWords) => GetPromptResult {
  return (words) => ({
    description: recipe.description,
    messages: [
      { role: 'user', content: { type: 'text', text: `${recipe.request(words)}\n\n${recipe.text}` } },
      ...formatMessageOf(recipe.format),
    ],
  });
}

export function serveRecipePrompts(
  server: Readonly<Pick<McpServer, 'registerPrompt'>>,
  recipes: readonly ShelvedRecipe[],
): void {
  for (const recipe of recipes) {
    server.registerPrompt(
      recipe.name,
      { title: recipe.title, description: recipe.description, argsSchema: wordsSchemaOf(recipe.arguments) },
      promptOf(recipe),
    );
  }
}

import type { StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';
import type { Registration } from '@on.auto/operations';

import {
  mostArgumentDescriptionCharacters,
  mostDescriptionCharacters,
  requireSentencesWithin,
  requireTextWithin,
} from '../bounds/served-bounds.ts';
import { argumentDescriptionsIn } from './argument-descriptions.ts';
import { withOptionalPlaybookArgument, withPlaybookArgument } from './playbook-argument.ts';
import { advertisedSchema, selfContainedSchemaOf, withEveryArgumentTyped, type JsonSchema } from './tool-schema.ts';

export interface ToolDefinition {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: StandardSchemaWithJSON;
  readonly annotations: ToolAnnotations;
}

function annotationsOf({ title, kind, reachesOutside, readsOnly, repeatable }: Registration): ToolAnnotations {
  const onlyReads = kind === 'query' || readsOnly;
  return {
    title,
    readOnlyHint: onlyReads,
    destructiveHint: !onlyReads,
    idempotentHint: kind === 'query' || repeatable,
    openWorldHint: reachesOutside,
  };
}

function requireArgumentsWithinBounds(name: string, schema: Readonly<JsonSchema>): void {
  for (const { where, description } of argumentDescriptionsIn(schema)) {
    requireTextWithin(`The description of ${where} of ${name}`, description, mostArgumentDescriptionCharacters);
  }
}

function requireDescriptionWithinBounds({ name, description }: Registration): void {
  requireTextWithin(`The description of ${name}`, description, mostDescriptionCharacters);
  requireSentencesWithin(`The description of ${name}`, description);
}

function definitionWith(registration: Registration, inputSchema: Readonly<JsonSchema>): ToolDefinition {
  requireDescriptionWithinBounds(registration);
  requireArgumentsWithinBounds(registration.name, inputSchema);
  return {
    title: registration.title,
    description: registration.description,
    inputSchema: advertisedSchema(withEveryArgumentTyped(inputSchema)),
    annotations: annotationsOf(registration),
  };
}

export function toolDefinitionOf(registration: Registration): ToolDefinition {
  return definitionWith(registration, selfContainedSchemaOf(registration.input));
}

export function toolDefinitionTakingPlaybookOf(registration: Registration<'playbook'>): ToolDefinition {
  return definitionWith(registration, withPlaybookArgument(selfContainedSchemaOf(registration.input)));
}

function toolDefinitionTakingPlaybookOrNoneOf(registration: Registration<'org'>): ToolDefinition {
  return definitionWith(registration, withOptionalPlaybookArgument(selfContainedSchemaOf(registration.input)));
}

export type Twins = ReadonlyMap<string, Registration<'playbook'>>;

export function twinsIn(
  orgRegistrations: readonly Registration<'org'>[],
  playbookRegistrations: readonly Registration<'playbook'>[],
): Twins {
  const named = new Set(orgRegistrations.filter(({ targetsPlaybook }) => !targetsPlaybook).map(({ name }) => name));
  return new Map(
    playbookRegistrations
      .filter(({ name }) => named.has(name))
      .map((registration) => [registration.name, registration]),
  );
}

export function orgToolDefinitionsBeside(twins: Twins): (registration: Registration<'org'>) => ToolDefinition {
  return (registration) =>
    twins.has(registration.name) ? toolDefinitionTakingPlaybookOrNoneOf(registration) : toolDefinitionOf(registration);
}

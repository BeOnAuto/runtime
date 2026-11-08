import { createHash } from 'node:crypto';

import { Effect, Order, Struct } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import type { Definition, ListedDefinition, StoredDefinition } from '../registry/definition.ts';
import { shapeNameIn } from '../shapes/published-output.ts';
import { sourceToPrepare } from './definition-views.ts';

export const byName = Order.mapInput(Order.String, ({ name }: StoredDefinition) => name);

export const mostSourcesKept = 1000;

type Kept = StoredDefinition & { readonly page?: DefinitionContent['page'] };

const warningsFoundByCapability = new WeakMap<Capability, Map<string, readonly string[]>>();

function warningsFoundBy(capability: Capability): Map<string, readonly string[]> {
  const known = warningsFoundByCapability.get(capability);
  if (known !== undefined) {
    return known;
  }
  const made = new Map<string, readonly string[]>();
  warningsFoundByCapability.set(capability, made);
  return made;
}

function digestOf(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function keptIn(found: Map<string, readonly string[]>, digest: string, warnings: readonly string[]): readonly string[] {
  if (found.size >= mostSourcesKept) {
    found.clear();
  }
  found.set(digest, warnings);
  return warnings;
}

function warningsOf(capability: Capability, { source, warnings: saved = [] }: Kept): Effect.Effect<readonly string[]> {
  return Effect.suspend(() => {
    const found = warningsFoundBy(capability);
    const digest = digestOf(source);
    const known = found.get(digest);
    return known === undefined
      ? capability.prepare(sourceToPrepare(capability.type, source)).pipe(
          Effect.map(({ summary }) => keptIn(found, digest, summary.warnings ?? [])),
          Effect.orElseSucceed(() => saved),
        )
      : Effect.succeed(known);
  });
}

function publishedDetails({ details }: StoredDefinition): Pick<Definition, 'details'> {
  const shape = shapeNameIn(details);
  return shape === undefined ? {} : { details: { shape } };
}

export function definitionOf(capability: Capability, stored: Kept): Effect.Effect<Definition> {
  return Effect.map(warningsOf(capability, stored), (warnings) => ({
    type: capability.type,
    media_type: capability.mediaType,
    ...Struct.omit(stored, ['details', 'stripped', 'page', 'warnings']),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...publishedDetails(stored),
  }));
}

export function listedDefinitionOf(capability: Capability, stored: Kept): Effect.Effect<ListedDefinition> {
  return Effect.map(definitionOf(capability, stored), (definition) =>
    Struct.omit(definition, ['source', 'overview', 'diagram']),
  );
}

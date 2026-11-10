import { createHash } from 'node:crypto';

import { Effect, Order, Struct } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { DefinitionTexts } from '../payloads/definition-texts.ts';
import { TextsInHand, textsByDigestOf, type TextsByDigest } from '../payloads/kept-texts.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import type { Definition, ListedDefinition, StoredDefinition } from '../registry/definition.ts';
import { shapeNameIn } from '../shapes/published-output.ts';
import { sourceToPrepare } from './definition-views.ts';
import { textsToAnswer, type Change } from './unread-texts.ts';

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

function warningsFoundIn(capability: Capability, source: string, saved: readonly string[]) {
  const found = warningsFoundBy(capability);
  const digest = digestOf(source);
  const known = found.get(digest);
  return known === undefined
    ? capability.prepare(sourceToPrepare(capability.type, source)).pipe(
        Effect.map(({ summary }) => keptIn(found, digest, summary.warnings ?? [])),
        Effect.orElseSucceed(() => saved),
      )
    : Effect.succeed(known);
}

function warningsOf(
  capability: Capability,
  { source, warnings: saved = [] }: Kept,
  text: string | undefined,
): Effect.Effect<readonly string[]> {
  return Effect.suspend(() => {
    if (text !== undefined) {
      return warningsFoundIn(capability, text, saved);
    }
    return 'inline' in source
      ? warningsFoundIn(capability, source.inline, saved)
      : Effect.succeed(warningsFoundBy(capability).get(source.kept.sha256) ?? saved);
  });
}

function publishedDetails({ details }: StoredDefinition): Pick<Definition, 'details'> {
  const shape = shapeNameIn(details);
  return shape === undefined ? {} : { details: { shape } };
}

const answeredApart = ['details', 'stripped', 'page', 'warnings', 'source', 'overview', 'diagram'] as const;

export function listedDefinitionOf(
  capability: Capability,
  stored: Kept,
  source?: string,
): Effect.Effect<ListedDefinition> {
  return Effect.map(warningsOf(capability, stored, source), (warnings) => ({
    type: capability.type,
    media_type: capability.mediaType,
    ...Struct.omit(stored, answeredApart),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...publishedDetails(stored),
  }));
}

export function definitionOf(
  capability: Capability,
  stored: Kept,
  texts: DefinitionTexts<string>,
): Effect.Effect<Definition> {
  return Effect.map(listedDefinitionOf(capability, stored, texts.source), (listed) => ({ ...listed, ...texts }));
}

export interface Answering {
  readonly change?: Change;
  readonly inHand?: TextsByDigest;
}

export interface DefinitionAnswered {
  readonly definition: Definition;
  readonly inHand: TextsByDigest;
}

export function withTheTextsInHand(inHand: TextsByDigest) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(effect, TextsInHand, inHand);
}

export function definitionAnswered(
  capability: Capability,
  stored: Kept,
  { change, inHand = new Map() }: Answering = {},
) {
  return textsToAnswer(capability.type, stored, change).pipe(
    Effect.flatMap((texts) =>
      Effect.map(definitionOf(capability, stored, texts), (definition): DefinitionAnswered => ({
        definition,
        inHand: textsByDigestOf(stored, texts),
      })),
    ),
    withTheTextsInHand(inHand),
  );
}

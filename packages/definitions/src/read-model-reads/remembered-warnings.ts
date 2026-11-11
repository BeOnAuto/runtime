import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { mostSourcesKept } from '../operations/answered-definitions.ts';
import { sourceToPrepare } from '../operations/definition-views.ts';

const rememberedByCapability = new WeakMap<Capability, Map<string, readonly string[]>>();

function rememberedBy(capability: Capability): Map<string, readonly string[]> {
  const known = rememberedByCapability.get(capability);
  if (known !== undefined) {
    return known;
  }
  const made = new Map<string, readonly string[]>();
  rememberedByCapability.set(capability, made);
  return made;
}

function remembered(capability: Capability, savedBy: string, warnings: readonly string[]): readonly string[] {
  const remembering = rememberedBy(capability);
  if (remembering.size >= mostSourcesKept) {
    remembering.clear();
  }
  remembering.set(savedBy, warnings);
  return warnings;
}

export interface Opened {
  readonly savedBy: string;
  readonly document: string;
  readonly saved: readonly string[];
}

export function warningsAtAnOpen(
  capability: Capability,
  { savedBy, document, saved }: Opened,
): Effect.Effect<readonly string[]> {
  const known = rememberedBy(capability).get(savedBy);
  return known === undefined
    ? capability.prepare(sourceToPrepare(capability.type, document)).pipe(
        Effect.map(({ summary }) => remembered(capability, savedBy, summary.warnings ?? [])),
        Effect.orElseSucceed(() => saved),
      )
    : Effect.succeed(known);
}

export function warningsOfAListEntry(
  capability: Capability,
  savedBy: string,
  saved: readonly string[],
): readonly string[] {
  return rememberedBy(capability).get(savedBy) ?? saved;
}

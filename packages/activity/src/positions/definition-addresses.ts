import { definitionResourceLabel } from '@on.auto/definitions';
import { NotFound, definitionOfStreamPrefix, playbookOfStreamPrefix, type PlaybookReader } from '@on.auto/operations';
import type { HeldName } from '@on.auto/operations/definition-names';
import { Effect, Option } from 'effect';

import {
  addressOfTarget,
  commentTargetOf,
  partsSegment,
  stepsSegment,
  type CommentTarget,
  type ListedTarget,
} from './comment-addresses.ts';

type OnADefinition = Extract<CommentTarget, { readonly kind: 'definition' | 'step' }>;

export type NamingADefinition = Extract<ListedTarget, { readonly kind: 'definition' | 'step' | 'every_version' }>;

export function isOnADefinition(target: ListedTarget | undefined): target is OnADefinition {
  return target?.kind === 'definition' || target?.kind === 'step';
}

export function namesADefinition(target: ListedTarget): target is NamingADefinition {
  return isOnADefinition(target) || target.kind === 'every_version';
}

interface AboutTheDefinition {
  readonly about_definition: string;
  readonly about_version: string;
  readonly about_thing: string;
  readonly about: string;
}

export function aboutTheDefinition(definition: string, target: OnADefinition): AboutTheDefinition {
  const version = `${definition}/${target.version}`;
  const thing = target.kind === 'step' ? `${version}/${stepsSegment}/${target.step}` : version;
  const part = target.kind === 'definition' ? target.part : undefined;
  return {
    about_definition: definition,
    about_version: version,
    about_thing: thing,
    about: part === undefined ? thing : `${thing}/${partsSegment}/${part}`,
  };
}

export type HeldDefinitions = Pick<PlaybookReader['Service'], 'holderOfName' | 'nameHeldBy'>;

export function definitionNamed(names: HeldDefinitions, type: string, name: string): Effect.Effect<string | undefined> {
  return Effect.map(names.holderOfName(type, name), (held) =>
    held === undefined
      ? undefined
      : Option.getOrUndefined(Option.map(definitionOfStreamPrefix(held.definitionKey), ({ definition }) => definition)),
  );
}

export function definitionHeldFor(
  names: HeldDefinitions,
  { type, name }: OnADefinition,
): Effect.Effect<string, NotFound> {
  return Effect.flatMap(definitionNamed(names, type, name), (definition) =>
    definition === undefined
      ? Effect.fail(new NotFound({ detail: `There is no ${definitionResourceLabel(type)} ${name} in this playbook` }))
      : Effect.succeed(definition),
  );
}

export function namesHeldNow(
  names: HeldDefinitions,
  definitions: readonly string[],
): Effect.Effect<ReadonlyMap<string, HeldName | undefined>> {
  return Effect.map(
    Effect.forEach([...new Set(definitions)], (definition) =>
      Effect.map(names.nameHeldBy(definition), (held) => [definition, held] as const),
    ),
    (held: readonly (readonly [string, HeldName | undefined])[]) => new Map(held),
  );
}

export function addressedAsHeld<Kept extends { readonly address: string }>(
  kept: Kept,
  held: HeldName | undefined,
): Kept {
  const target = commentTargetOf(kept.address);
  const playbook = held === undefined ? undefined : Option.getOrUndefined(playbookOfStreamPrefix(held.playbookKey));
  return held === undefined || playbook === undefined || !isOnADefinition(target)
    ? kept
    : {
        ...kept,
        address: addressOfTarget({
          ...target,
          playbook: playbook.playbook,
          type: held.definitionType,
          name: held.name,
        }),
      };
}

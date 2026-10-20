import { JsonPointer, type Schema } from 'effect';

import { byName, referencesIn } from './discovery-document.ts';

type Json = Schema.Json;

type JsonFields = Readonly<Record<string, Json>>;

export type Components = Readonly<Record<string, Readonly<Record<string, Json>>>>;

interface Component {
  readonly kind: string;
  readonly name: string;
  readonly value: Json;
}

export type HeldComponents = ReadonlyMap<string, Component>;

export interface Reaching {
  readonly id: string;
  readonly operation: JsonFields;
  readonly held: HeldComponents;
}

function referenceOf(kind: string, name: string): string {
  return `#/components/${JsonPointer.escapeToken(kind)}/${JsonPointer.escapeToken(name)}`;
}

export function heldComponentsOf(components: Components): HeldComponents {
  return new Map(
    Object.entries(components).flatMap(([kind, named]: readonly [string, Readonly<Record<string, Json>>]) =>
      Object.entries(named).map(([name, value]: readonly [string, Json]): readonly [string, Component] => [
        referenceOf(kind, name),
        { kind, name, value },
      ]),
    ),
  );
}

function reachedFrom({ id, operation, held }: Reaching, reached: Map<string, Component>): void {
  const pending = [...referencesIn(operation)];
  for (let reference = pending.pop(); reference !== undefined; reference = pending.pop()) {
    const component = held.get(reference);
    if (component === undefined) {
      throw new Error(`The operation ${id} refers to ${reference}, which is no component its document holds`);
    }
    const before = reached.get(reference);
    if (before === undefined) {
      reached.set(reference, component);
      pending.push(...referencesIn(component.value));
    } else if (JSON.stringify(before.value) !== JSON.stringify(component.value)) {
      throw new Error(`The documents the translation is made from hold ${reference} each its own way`);
    }
  }
}

export function componentsReachedBy(kept: readonly Reaching[]): Components {
  const reached = new Map<string, Component>();
  for (const each of kept) {
    reachedFrom(each, reached);
  }
  const components = [...reached.values()];
  const kinds = [...new Set(components.map(({ kind }) => kind))].toSorted();
  return Object.fromEntries(
    kinds.map((kind): readonly [string, Readonly<Record<string, Json>>] => [
      kind,
      Object.fromEntries(
        components
          .filter((component) => component.kind === kind)
          .map(({ name, value }): readonly [string, Json] => [name, value])
          .toSorted(byName),
      ),
    ]),
  );
}

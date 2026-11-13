import { Function } from 'effect';

import {
  boundRefusal,
  claimsOf,
  definitionsInTheAppend,
  isOfTheKind,
  isTheSameName,
  judgedOf,
  kindsChanged,
  takenRefusal,
  type DefinitionJudged,
  type DefinitionNames,
  type HeldName,
  type NamedMessage,
  type Refusal,
} from '../definition-names/name-judgement.ts';
import { Conflict } from '../outcome/conflict.ts';

type StagedNames = { readonly refused: Conflict } | { readonly commit: () => void };

export interface MemoryNames {
  readonly staged: (messages: readonly NamedMessage[]) => StagedNames;
  readonly held: () => readonly HeldName[];
}

function conflictOf({ conflict: { detail, kind } }: Refusal): Conflict {
  return new Conflict({ detail, ...(kind === undefined ? {} : { kind }) });
}

function firstRefusalOf(
  names: DefinitionNames,
  rows: ReadonlyMap<string, HeldName>,
  judged: readonly DefinitionJudged[],
): Refusal | undefined {
  for (const claim of claimsOf(judged)) {
    const holder = [...rows.values()].find((row) => isTheSameName(row, claim.claimed));
    const refusal = takenRefusal(names, judged, claim, holder);
    if (refusal !== undefined) {
      return refusal;
    }
  }
  for (const kind of kindsChanged(judged)) {
    const before = [...rows.values()].filter((row) => isOfTheKind(row, kind));
    const refusal = boundRefusal(names, judged, kind, before);
    if (refusal !== undefined) {
      return refusal;
    }
  }
  return undefined;
}

function committed(rows: Map<string, HeldName>, judged: readonly DefinitionJudged[]): void {
  const changed = judged.filter(({ changedBy }) => changedBy.length > 0);
  for (const { definitionKey } of changed) {
    rows.delete(definitionKey);
  }
  for (const { definitionKey, end } of changed) {
    if (end !== undefined) {
      rows.set(definitionKey, { definitionKey, ...end });
    }
  }
}

const nothingToKeep: StagedNames = { commit: Function.constVoid };

export function memoryNames(names: DefinitionNames | undefined): MemoryNames {
  const rows = new Map<string, HeldName>();
  return {
    held: () =>
      [...rows.keys()]
        .toSorted()
        .map((key) => rows.get(key))
        .filter((row) => row !== undefined),
    staged: (messages) => {
      if (names === undefined) {
        return nothingToKeep;
      }
      const judged = definitionsInTheAppend(
        names,
        messages.filter(({ type }) => names.types.includes(type)),
      ).map((definition) => judgedOf(names, definition, rows.get(definition.definitionKey)));
      const refusal = firstRefusalOf(names, rows, judged);
      return refusal === undefined
        ? {
            commit: () => {
              committed(rows, judged);
            },
          }
        : { refused: conflictOf(refusal) };
    },
  };
}

import { Conflict, InvalidInput, readInside, type AssetNotRead, type InsideReading } from '@on.auto/operations';
import { JsonPointer, type Effect, type Schema } from 'effect';

import { isAtOrWithin } from '../checking/standing-assets.ts';
import type { VariableReference } from './template-parsing.ts';

const membersLiquidAnswers: ReadonlySet<string> = new Set(['first', 'last', 'size']);

function placeReadAt([root, ...members]: VariableReference['path']): readonly string[] {
  if (root !== 'input') {
    return [];
  }
  const tokens: string[] = [];
  for (const member of members) {
    if (member === null || (typeof member === 'string' && membersLiquidAnswers.has(member))) {
      break;
    }
    tokens.push(`/${JsonPointer.escapeToken(String(member))}`);
  }
  return [tokens.join('')];
}

export function unreadAssetOf({ because, pointer, detail }: AssetNotRead): Conflict | InvalidInput {
  return because === 'too_large'
    ? new Conflict({ detail, kind: 'unworkable' })
    : new InvalidInput({ detail, issues: [{ pointer, detail }] });
}

export function inputReadBy(
  variables: readonly VariableReference[],
  input: Schema.Json,
  reading: InsideReading,
): Effect.Effect<Schema.Json, AssetNotRead> {
  const places = variables.flatMap(({ path }) => placeReadAt(path));
  return readInside(
    input,
    (pointer) => places.some((place) => isAtOrWithin(pointer, place) || isAtOrWithin(place, pointer)),
    reading,
  );
}

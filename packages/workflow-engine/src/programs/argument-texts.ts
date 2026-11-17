import { assetsIn } from '@on.auto/operations';
import { JsonPointer } from 'effect';

export type AssetPlace = readonly string[];

export interface ArgumentText {
  readonly text: string;
  readonly assets: readonly AssetPlace[];
}

function placeOf(pointer: string): AssetPlace {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
}

export function argumentTextOf(value: unknown): ArgumentText {
  return { text: JSON.stringify(value), assets: assetsIn(value).map(({ pointer }) => placeOf(pointer)) };
}

import { Data } from 'effect';

import { jsonOfText, type Json } from '../dsl/json.ts';
import type { HeldValue, KeptValue } from './held-value.ts';
import { heldValueOf, reachableValueIds } from './held-values.ts';
import type { RunState } from './run-state.ts';

export type HeldContent =
  | { readonly kind: 'read'; readonly text: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'erased' };

export type HeldContents = ReadonlyMap<string, HeldContent>;

export interface RunAtHand {
  readonly contents: HeldContents;
  readonly format: number | null;
  readonly payloadOffloading: boolean;
}

export function nothingAtHand(): RunAtHand {
  return { contents: new Map(), format: null, payloadOffloading: false };
}

export interface LostContent {
  readonly sha256: string;
  readonly kind: 'missing' | 'erased';
}

export class HeldContentNotGiven extends Data.TaggedError('held_content_not_given')<{ readonly sha256: string }> {}

export function isKept(held: HeldValue): held is KeptValue {
  return 'sha256' in held;
}

export function keptValuesReached(state: RunState): readonly KeptValue[] {
  const kept = reachableValueIds(state)
    .map((id) => heldValueOf(state, id))
    .filter((held) => isKept(held));
  return [...new Map(kept.map((held) => [held.sha256, held])).values()];
}

export function heldContentOf(contents: HeldContents, sha256: string): HeldContent {
  const content = contents.get(sha256);
  if (content === undefined) {
    throw new HeldContentNotGiven({ sha256 });
  }
  return content;
}

export function lostContentOf(state: RunState, contents: HeldContents): LostContent | undefined {
  for (const { sha256 } of keptValuesReached(state)) {
    const { kind } = heldContentOf(contents, sha256);
    if (kind !== 'read') {
      return { sha256, kind };
    }
  }
  return undefined;
}

export function heldJsonOf(held: HeldValue, contents: HeldContents): Json | undefined {
  if (!isKept(held)) {
    return held.value;
  }
  const content = heldContentOf(contents, held.sha256);
  return content.kind === 'read' ? jsonOfText(content.text) : undefined;
}

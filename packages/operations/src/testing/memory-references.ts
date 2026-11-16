import type { ContentOwner, KeptOutside } from '@on.auto/content';
import type { HeldIn } from '@on.auto/content/testing';
import { Clock, Effect, Function } from 'effect';

import type { ContentHolders } from '../held-content/content-declaration.ts';
import { heldOver, type HeldDigests } from '../held-content/held-digests.ts';
import { keptContentGraceMs, noHoldersKnown, type UnheldContentRemover } from '../held-content/unheld-removal.ts';
import type { TypedEvent } from '../ledger/decider.ts';
import { addressedStreamOf } from '../projections/keyed-projection.ts';

export interface MemoryReferences {
  readonly staged: (stream: string, facts: readonly TypedEvent[]) => () => void;
  readonly refold: (stream: string, facts: readonly TypedEvent[]) => void;
  readonly heldIn: HeldIn;
  readonly removalOver: (outside: KeptOutside) => UnheldContentRemover['removeUnheld'];
}

function ofAPlaybook(stream: string): boolean {
  return addressedStreamOf(stream)?.scope === 'playbook';
}

function heldAmong(held: ReadonlyMap<string, HeldDigests>, { org }: ContentOwner, sha256: string): boolean {
  return [...held].some(
    ([stream, digests]: readonly [string, HeldDigests]) =>
      addressedStreamOf(stream)?.address.org === org && (digests.get(sha256) ?? 0) > 0,
  );
}

function referencesBy(holders: ContentHolders): MemoryReferences {
  const held = new Map<string, HeldDigests>();
  const folded = (stream: string, facts: readonly TypedEvent[], from?: HeldDigests): (() => void) => {
    if (!ofAPlaybook(stream)) {
      return Function.constVoid;
    }
    const after = heldOver(holders, facts, from);
    return () => {
      held.set(stream, after);
    };
  };
  return {
    staged: (stream, facts) => folded(stream, facts, held.get(stream)),
    refold: (stream, facts) => {
      folded(stream, facts)();
    },
    heldIn: (owner, sha256) => heldAmong(held, owner, sha256),
    removalOver:
      ({ removedKeptBefore }) =>
      (owner, sha256) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => removedKeptBefore(owner, sha256, now - keptContentGraceMs)),
  };
}

const unknownHolders: MemoryReferences = {
  staged: () => Function.constVoid,
  refold: Function.constVoid,
  heldIn: Function.constFalse,
  removalOver: () => () => Effect.die(noHoldersKnown()),
};

export function memoryReferences(holders: ContentHolders | undefined): MemoryReferences {
  return holders === undefined ? unknownHolders : referencesBy(holders);
}

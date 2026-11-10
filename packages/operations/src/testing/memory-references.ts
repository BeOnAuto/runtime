import type { KeptOutside } from '@on.auto/content';
import type { HeldIn } from '@on.auto/content/testing';
import { Clock, Effect, Function } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import type { ContentHolders } from '../held-content/content-declaration.ts';
import { heldOver, type HeldDigests } from '../held-content/held-digests.ts';
import { keptContentGraceMs, noHoldersKnown, type UnheldContentRemover } from '../held-content/unheld-removal.ts';
import { streamPrefixOfPlaybook } from '../ledger/bound-ports.ts';
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

function heldAmong(held: ReadonlyMap<string, HeldDigests>, playbook: PlaybookAddress, sha256: string): boolean {
  const prefix = streamPrefixOfPlaybook(playbook);
  return [...held].some(
    ([stream, digests]: readonly [string, HeldDigests]) => stream.startsWith(prefix) && (digests.get(sha256) ?? 0) > 0,
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
    heldIn: (playbook, sha256) => heldAmong(held, playbook, sha256),
    removalOver:
      ({ removedKeptBefore }) =>
      (playbook, sha256) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => removedKeptBefore(playbook, sha256, now - keptContentGraceMs)),
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
